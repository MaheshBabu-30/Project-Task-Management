import { db } from "../../config/db.js";
import { tasks, projects, taskAssignees, projectMembers, orgMembers, users } from "../../../drizzle/schema.js";
import { eq, and, ilike, asc, desc, inArray, isNull, isNotNull, notInArray, count, type InferSelectModel } from "drizzle-orm";
import { AppError } from "../../utils/errors.js";
import { createNotification } from "../notifications/notification.service.js";
import { catchError } from "../../utils/logger.js";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type TaskStatus = "to_do" | "in_progress" | "on_hold" | "completed" | "overdue";
type TaskPriority = "low" | "medium" | "high" | "urgent";
type UserSummary = { id: string; name: string | null; email: string; avatarUrl: string | null };
type TaskRecord = InferSelectModel<typeof tasks>;

interface TaskQuery {
  id?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  search?: string;
  projectId?: string;
  parentTaskId?: string;
  assignedUserId?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  order?: string;
  showDeleted?: boolean;
}

interface UpdateTaskData {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string | null;
  status?: "to_do" | "in_progress" | "on_hold" | "completed";
  assignedUserIds?: string[];
}

type TaskUpdatePayload = {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string | null;
  status?: TaskStatus;
  completedAt?: Date | null;
  updatedAt?: Date;
};

// ─── Compute Effective Task Status ───────────────────────────────────────────

const getEffectiveStatus = (task: { dueDate: string | null; status: string }): TaskStatus => {
  const today = new Date().toISOString().split("T")[0]!;
  if (
    task.dueDate &&
    task.dueDate < today &&
    !["completed", "on_hold", "overdue"].includes(task.status)
  ) {
    return "overdue";
  }
  return task.status as TaskStatus;
};

// ─── Allowed Task Status Transitions ─────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  to_do:       ["in_progress", "on_hold"],
  in_progress: ["on_hold", "completed"],
  on_hold:     ["in_progress", "to_do"],
  completed:   ["in_progress"], // reopen — admin and superadmin only
  overdue:     ["in_progress", "on_hold"],
};

// ─── Helper: Update Project Status ───────────────────────────────────────────

const updateProjectStatusIfComplete = async (tx: DbTransaction, projectId: string) => {
  // Check if all ROOT tasks in this project are completed (subtasks don't count)
  const pendingTasks = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(
      eq(tasks.projectId, projectId),
      isNull(tasks.deletedAt),
      isNull(tasks.parentTaskId),
      notInArray(tasks.status, ["completed"])
    ));

  if (pendingTasks.length === 0) {
    await tx.update(projects).set({ status: "completed" }).where(eq(projects.id, projectId));
  } else {
    // If there are pending tasks, ensure it's "active" (unless it was on_hold)
    const [project] = await tx.select({ status: projects.status }).from(projects).where(eq(projects.id, projectId));
    if (project?.status === "completed") {
      await tx.update(projects).set({ status: "active" }).where(eq(projects.id, projectId));
    }
  }
};

// ─── Create Task ──────────────────────────────────────────────────────────────

export const createTask = async (data: {
  title: string;
  description?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  dueDate?: string;
  projectId: string;
  parentTaskId?: string;
  createdBy: string;
  assignedUserIds?: string[];
  requesterOrgId?: string;
}) => {
  const { assignedUserIds, requesterOrgId, ...taskData } = data;

  const newTask = await db.transaction(async (tx) => {
    // 1. Validate project belongs to requester's org (skipped for superadmin)
    if (requesterOrgId) {
      const [project] = await tx
        .select({ orgId: projects.orgId })
        .from(projects)
        .where(and(eq(projects.id, taskData.projectId), isNull(projects.deletedAt)));

      if (!project) throw new AppError("Project not found", 404);
      if (project.orgId !== requesterOrgId) throw new AppError("Project does not belong to your organization", 403);
    }

    // 3. Subtask validation
    if (taskData.parentTaskId) {
      const [parent] = await tx
        .select({ id: tasks.id, projectId: tasks.projectId, parentTaskId: tasks.parentTaskId })
        .from(tasks)
        .where(and(eq(tasks.id, taskData.parentTaskId), isNull(tasks.deletedAt)));

      if (!parent) throw new AppError("Parent task not found", 404);
      if (parent.projectId !== taskData.projectId) throw new AppError("Subtask must belong to the same project as its parent", 400);
      if (parent.parentTaskId) throw new AppError("Cannot create a subtask of a subtask. Max 1 level deep.", 400);
    }

    // 2. Insert Task
    const [task] = await tx
      .insert(tasks)
      .values({
        ...taskData,
        dueDate: taskData.dueDate || null,
      })
      .returning();

    if (!task) throw new AppError("Failed to create task", 500);

    // 3. Assign Developers
    if (assignedUserIds && assignedUserIds.length > 0) {
      const [project] = await tx
        .select({ orgId: projects.orgId })
        .from(projects)
        .where(eq(projects.id, taskData.projectId));

      if (project) {
        const validMembers = await tx
          .select({ userId: orgMembers.userId })
          .from(orgMembers)
          .where(and(
            eq(orgMembers.orgId, project.orgId),
            inArray(orgMembers.userId, assignedUserIds),
            eq(orgMembers.role, "developer")
          ));

        if (validMembers.length !== assignedUserIds.length) {
          throw new AppError("One or more assigned users are not developers in this organization", 400);
        }
      }

      const assignEntries = assignedUserIds.map((userId) => ({
        taskId: task.id,
        userId,
      }));
      await tx.insert(taskAssignees).values(assignEntries);

      // Auto-add assignees to projectMembers so they can view the project
      await tx
        .insert(projectMembers)
        .values(assignedUserIds.map((userId) => ({ projectId: taskData.projectId, userId })))
        .onConflictDoNothing();

      // Notify each assigned user (fire-and-forget)
      for (const userId of assignedUserIds) {
        createNotification({
          userId,
          type: "task_assigned",
          title: "You have been assigned a task",
          body: `You were assigned to: "${task.title}"`,
          entityType: "task",
          entityId: task.id,
        }).catch(catchError("createTask:notify"));
      }
    }

    // 4. Update project status (new task means project might no longer be 'completed')
    if (task) {
      await updateProjectStatusIfComplete(tx, task.projectId);
    }

    return task;
  });

  // Fetch assignees with user info to return consistent shape
  const assignees = await db
    .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
    .from(taskAssignees)
    .innerJoin(users, eq(taskAssignees.userId, users.id))
    .where(eq(taskAssignees.taskId, newTask.id));

  const [creator] = newTask.createdBy
    ? await db
        .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
        .from(users)
        .where(eq(users.id, newTask.createdBy))
    : [null];

  return { ...newTask, assignees, creator: creator ?? null };
};

// ─── Get Tasks (Scoped) ───────────────────────────────────────────────────────

export const getTasks = async (
  query: TaskQuery,
  user: { userId: string; role: string; orgId?: string }
) => {
  const { id, status, priority, search, projectId, parentTaskId, assignedUserId, page = 1, limit = 10, sortBy = "id", order = "asc", showDeleted = false } = query;

  const filters = [showDeleted ? isNotNull(tasks.deletedAt) : isNull(tasks.deletedAt)];

  // By default return only root tasks; if parentTaskId provided, return subtasks of that task
  if (parentTaskId) {
    filters.push(eq(tasks.parentTaskId, parentTaskId));
  } else if (!id) {
    filters.push(isNull(tasks.parentTaskId));
  }

  // 1. Scoping by Org (via Project Join)
  if (user.role !== "superadmin") {
    if (!user.orgId) throw new AppError("No organization assigned", 403);
    
    const orgProjectIds = db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.orgId, user.orgId));
    
    filters.push(inArray(tasks.projectId, orgProjectIds));
  }

  // 2. Role-based Scoping
  if (user.role === "developer") {
    const userTaskIds = db
      .select({ taskId: taskAssignees.taskId })
      .from(taskAssignees)
      .where(eq(taskAssignees.userId, user.userId));
    
    filters.push(inArray(tasks.id, userTaskIds));
  }

  // 3. Optional Filters
  if (id) filters.push(eq(tasks.id, id));
  if (status) filters.push(eq(tasks.status, status));
  if (priority) filters.push(eq(tasks.priority, priority));
  if (projectId) filters.push(eq(tasks.projectId, projectId));
  if (search) filters.push(ilike(tasks.title, `%${search}%`));
  
  if (assignedUserId) {
    const specificUserTaskIds = db
      .select({ taskId: taskAssignees.taskId })
      .from(taskAssignees)
      .where(eq(taskAssignees.userId, assignedUserId));
    filters.push(inArray(tasks.id, specificUserTaskIds));
  }

  const whereCondition = and(...filters);
  const offset = (page - 1) * limit;

  // 4. Sorting logic
  const columnMap = {
    id: tasks.id,
    title: tasks.title,
    status: tasks.status,
    priority: tasks.priority,
    dueDate: tasks.dueDate,
    createdAt: tasks.createdAt,
  } as const;
  const orderColumn = (sortBy in columnMap ? columnMap[sortBy as keyof typeof columnMap] : tasks.id);
  const orderDirection = order === "desc" ? desc(orderColumn) : asc(orderColumn);

  const data = await db
    .select()
    .from(tasks)
    .where(whereCondition)
    .orderBy(orderDirection)
    .limit(limit)
    .offset(offset);

  // 5. Fetch all assignees for the tasks in one batch query (Fix N+1)
  const taskIds = data.map((t) => t.id);
  let assigneesMap: Record<string, UserSummary[]> = {};

  if (taskIds.length > 0) {
    const allAssignees = await db
      .select({
        taskId: taskAssignees.taskId,
        id: users.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
      })
      .from(taskAssignees)
      .innerJoin(users, eq(taskAssignees.userId, users.id))
      .where(inArray(taskAssignees.taskId, taskIds));

    allAssignees.forEach((a) => {
      const tId = a.taskId;
      if (!tId) return;
      if (!assigneesMap[tId]) assigneesMap[tId] = [];
      assigneesMap[tId]!.push({
        id: a.id,
        name: a.name,
        email: a.email,
        avatarUrl: a.avatarUrl,
      });
    });
  }

  // Batch fetch creators
  const creatorIds = [...new Set(data.map((t) => t.createdBy).filter(Boolean))] as string[];
  const creatorsMap: Record<string, UserSummary> = {};
  if (creatorIds.length > 0) {
    const allCreators = await db
      .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
      .from(users)
      .where(inArray(users.id, creatorIds));
    allCreators.forEach((c) => { creatorsMap[c.id] = c; });
  }

  const dataWithAssignees = data.map((task) => ({
    ...task,
    status: getEffectiveStatus(task),
    assignees: assigneesMap[task.id] || [],
    creator: task.createdBy ? (creatorsMap[task.createdBy] ?? null) : null,
  }));

  const countResult = await db
    .select({ total: count() })
    .from(tasks)
    .where(whereCondition);

  return { data: dataWithAssignees, totalRecords: countResult[0]?.total ?? 0 };
};

// ─── Get Task By ID ───────────────────────────────────────────────────────────

export const getTaskById = async (id: string, user: { userId: string; role: string; orgId?: string }) => {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), isNull(tasks.deletedAt)));

  if (!task) throw new AppError("Task not found", 404);

  // 1. Scoping Check
  if (user.role !== "superadmin") {
    const [project] = await db
      .select({ orgId: projects.orgId })
      .from(projects)
      .where(eq(projects.id, task.projectId));
    
    if (project?.orgId !== user.orgId) {
      throw new AppError("Access denied", 403);
    }

    if (user.role === "developer") {
      const [assigned] = await db
        .select()
        .from(taskAssignees)
        .where(and(eq(taskAssignees.taskId, id), eq(taskAssignees.userId, user.userId)));
      
      if (!assigned) throw new AppError("Access denied. Task not assigned to you.", 403);
    }
  }

  // 2. Fetch assignees
  const assignees = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(taskAssignees)
    .innerJoin(users, eq(taskAssignees.userId, users.id))
    .where(eq(taskAssignees.taskId, id));

  // 3. Fetch creator
  const [creator] = task.createdBy
    ? await db
        .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
        .from(users)
        .where(eq(users.id, task.createdBy))
    : [null];

  // 4. Fetch subtasks (only for root tasks) with their assignees
  type SubtaskWithAssignees = TaskRecord & { assignees: UserSummary[] };
  let subtasks: SubtaskWithAssignees[] = [];
  if (!task.parentTaskId) {
    const rawSubtasks = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.parentTaskId, id), isNull(tasks.deletedAt)));

    if (rawSubtasks.length > 0) {
      const subtaskIds = rawSubtasks.map((s) => s.id);
      const subtaskAssigneeRows = await db
        .select({
          taskId: taskAssignees.taskId,
          id: users.id,
          name: users.name,
          email: users.email,
          avatarUrl: users.avatarUrl,
        })
        .from(taskAssignees)
        .innerJoin(users, eq(taskAssignees.userId, users.id))
        .where(inArray(taskAssignees.taskId, subtaskIds));

      const subtaskAssigneesMap: Record<string, UserSummary[]> = {};
      subtaskAssigneeRows.forEach((a) => {
        if (!subtaskAssigneesMap[a.taskId!]) subtaskAssigneesMap[a.taskId!] = [];
        subtaskAssigneesMap[a.taskId!]!.push({ id: a.id, name: a.name, email: a.email, avatarUrl: a.avatarUrl });
      });

      subtasks = rawSubtasks.map((s) => ({ ...s, status: getEffectiveStatus(s), assignees: subtaskAssigneesMap[s.id] ?? [] }));
    }
  }

  return { ...task, status: getEffectiveStatus(task), assignees, creator: creator ?? null, subtasks };
};

// ─── Update Task ──────────────────────────────────────────────────────────────

export const updateTask = async (id: string, data: UpdateTaskData, orgId?: string) => {
  const { assignedUserIds, ...updateData } = data;

  const result = await db.transaction(async (tx) => {
    // 1. Check if task belongs to org
    const [task] = orgId
      ? await tx
          .select({ projectId: tasks.projectId, status: tasks.status, parentTaskId: tasks.parentTaskId })
          .from(tasks)
          .innerJoin(projects, eq(tasks.projectId, projects.id))
          .where(and(eq(tasks.id, id), eq(projects.orgId, orgId), isNull(tasks.deletedAt)))
      : await tx
          .select({ projectId: tasks.projectId, status: tasks.status, parentTaskId: tasks.parentTaskId })
          .from(tasks)
          .where(and(eq(tasks.id, id), isNull(tasks.deletedAt)));

    if (!task) throw new AppError("Task not found or access denied", 404);

    // 2. Enforce status transition rules
    if (data.status && data.status !== task.status) {
      const allowed = ALLOWED_TRANSITIONS[task.status] ?? [];
      if (!allowed.includes(data.status)) {
        throw new AppError(`Cannot transition from "${task.status}" to "${data.status}"`, 400);
      }
    }

    // Prevent any status change on a subtask if its parent task is already completed
    if (data.status && data.status !== task.status && task.parentTaskId) {
      const [parentTask] = await tx
        .select({ status: tasks.status })
        .from(tasks)
        .where(and(eq(tasks.id, task.parentTaskId), isNull(tasks.deletedAt)));

      if (parentTask?.status === "completed") {
        throw new AppError(
          "Cannot change the status of a subtask while its parent task is completed. Reopen the parent task first.",
          400
        );
      }
    }

    // Block completion if any subtasks are not yet completed
    if (data.status === "completed" && task.status !== "completed") {
      const incompleteSubtasks = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(
          eq(tasks.parentTaskId, id),
          isNull(tasks.deletedAt),
          notInArray(tasks.status, ["completed"])
        ));

      if (incompleteSubtasks.length > 0) {
        throw new AppError(
          `Cannot complete this task: ${incompleteSubtasks.length} subtask(s) are not yet completed`,
          400
        );
      }
    }

    // 3. Update Task
    const preparedData: TaskUpdatePayload = { ...updateData, updatedAt: new Date() };
    if (data.dueDate !== undefined) preparedData.dueDate = data.dueDate;

    // Set completedAt when transitioning to/from completed
    if (data.status === "completed" && task.status !== "completed") {
      preparedData.completedAt = new Date();
    } else if (data.status && data.status !== "completed" && task.status === "completed") {
      preparedData.completedAt = null;
    }

    const [updated] = await tx
      .update(tasks)
      .set(preparedData)
      .where(eq(tasks.id, id))
      .returning();

    if (!updated) throw new AppError("Task not found or access denied", 404);

    // 3. Sync Assignees
    if (assignedUserIds) {
      if (assignedUserIds.length === 0) {
        throw new AppError("assignedUserIds cannot be empty. Omit the field to keep current assignees.", 400);
      }
      await tx.delete(taskAssignees).where(eq(taskAssignees.taskId, id));
      if (assignedUserIds.length > 0) {
        const [proj] = await tx
          .select({ orgId: projects.orgId })
          .from(projects)
          .where(eq(projects.id, task.projectId));

        if (proj) {
          const validMembers = await tx
            .select({ userId: orgMembers.userId })
            .from(orgMembers)
            .where(and(
              eq(orgMembers.orgId, proj.orgId),
              inArray(orgMembers.userId, assignedUserIds),
              eq(orgMembers.role, "developer")
            ));

          if (validMembers.length !== assignedUserIds.length) {
            throw new AppError("One or more assigned users are not developers in this organization", 400);
          }
        }

        const assignEntries = assignedUserIds.map((userId: string) => ({
          taskId: id,
          userId,
        }));
        await tx.insert(taskAssignees).values(assignEntries);

        // Auto-add assignees to projectMembers so they can view the project
        await tx
          .insert(projectMembers)
          .values(assignedUserIds.map((userId: string) => ({ projectId: task.projectId, userId })))
          .onConflictDoNothing();

        // Notify newly assigned users (fire-and-forget)
        for (const userId of assignedUserIds) {
          createNotification({
            userId,
            type: "task_assigned",
            title: "You have been assigned a task",
            body: `You were assigned to: "${updated.title}"`,
            entityType: "task",
            entityId: id,
          }).catch(catchError("updateTask:notify"));
        }
      }
    }

    // 4. Update Project Status if task status changed to 'completed'
    if (data.status) {
      await updateProjectStatusIfComplete(tx, updated.projectId);
    }

    return updated;
  });

  // Fetch assignees with user info to return consistent shape
  const assignees = await db
    .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
    .from(taskAssignees)
    .innerJoin(users, eq(taskAssignees.userId, users.id))
    .where(eq(taskAssignees.taskId, id));

  const [creator] = result.createdBy
    ? await db
        .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
        .from(users)
        .where(eq(users.id, result.createdBy))
    : [null];

  return { ...result, assignees, creator: creator ?? null };
};

// ─── Update Task Status Only (Developer + Admin) ─────────────────────────────

export const updateTaskStatus = async (
  id: string,
  newStatus: string,
  user: { userId: string; role: string; orgId?: string }
) => {
  const statusResult = await db.transaction(async (tx) => {
    // Build scope filter
    let taskQuery;
    if (user.role === "superadmin") {
      taskQuery = await tx
        .select({ projectId: tasks.projectId, status: tasks.status, parentTaskId: tasks.parentTaskId })
        .from(tasks)
        .where(and(eq(tasks.id, id), isNull(tasks.deletedAt)));
    } else {
      if (!user.orgId) throw new AppError("No organization assigned", 403);
      taskQuery = await tx
        .select({ projectId: tasks.projectId, status: tasks.status, parentTaskId: tasks.parentTaskId })
        .from(tasks)
        .innerJoin(projects, eq(tasks.projectId, projects.id))
        .where(and(eq(tasks.id, id), eq(projects.orgId, user.orgId), isNull(tasks.deletedAt)));
    }

    const [task] = taskQuery;
    if (!task) throw new AppError("Task not found or access denied", 404);

    // Developer must be assigned to the task
    if (user.role === "developer") {
      const [assigned] = await tx
        .select()
        .from(taskAssignees)
        .where(and(eq(taskAssignees.taskId, id), eq(taskAssignees.userId, user.userId)));
      if (!assigned) throw new AppError("Access denied. Task not assigned to you.", 403);
    }

    // Enforce transition rules
    const allowed = ALLOWED_TRANSITIONS[task.status] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new AppError(`Cannot transition from "${task.status}" to "${newStatus}"`, 400);
    }

    // Only admins and superadmins can reopen a completed task
    if (task.status === "completed" && user.role === "developer") {
      throw new AppError("Only admins and superadmins can reopen completed tasks", 403);
    }

    // Prevent any status change on a subtask if its parent task is already completed
    if (task.parentTaskId) {
      const [parentTask] = await tx
        .select({ status: tasks.status })
        .from(tasks)
        .where(and(eq(tasks.id, task.parentTaskId), isNull(tasks.deletedAt)));

      if (parentTask?.status === "completed") {
        throw new AppError(
          "Cannot change the status of a subtask while its parent task is completed. Reopen the parent task first.",
          400
        );
      }
    }

    // Block completion if any subtasks are not yet completed
    if (newStatus === "completed") {
      const incompleteSubtasks = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(
          eq(tasks.parentTaskId, id),
          isNull(tasks.deletedAt),
          notInArray(tasks.status, ["completed"])
        ));

      if (incompleteSubtasks.length > 0) {
        throw new AppError(
          `Cannot complete this task: ${incompleteSubtasks.length} subtask(s) are not yet completed`,
          400
        );
      }
    }

    const completedAt = newStatus === "completed" ? new Date() : null;

    const [updated] = await tx
      .update(tasks)
      .set({ status: newStatus as TaskStatus, completedAt, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning();

    await updateProjectStatusIfComplete(tx, task.projectId);

    return updated;
  });

  if (!statusResult) throw new AppError("Task not found", 404);

  // Fire-and-forget notifications AFTER transaction commits to avoid connection race conditions
  if (newStatus === "completed") {
    db.select({ userId: taskAssignees.userId })
      .from(taskAssignees)
      .where(eq(taskAssignees.taskId, id))
      .then((assignees) => {
        for (const assignee of assignees) {
          createNotification({
            userId: assignee.userId,
            type: "task_completed",
            title: "Task marked as completed",
            body: `"${statusResult.title}" has been marked as completed.`,
            entityType: "task",
            entityId: id,
          }).catch(catchError("updateTaskStatus:notify"));
        }
      })
      .catch(catchError("updateTaskStatus:fetchAssignees"));
  }

  // Fetch assignees with user info to return consistent shape
  const assignees = await db
    .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
    .from(taskAssignees)
    .innerJoin(users, eq(taskAssignees.userId, users.id))
    .where(eq(taskAssignees.taskId, id));

  const [creator] = statusResult.createdBy
    ? await db
        .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
        .from(users)
        .where(eq(users.id, statusResult.createdBy))
    : [null];

  return { ...statusResult, assignees, creator: creator ?? null };
};

// ─── Soft Delete Task ────────────────────────────────────────────────────────

export const softDeleteTask = async (id: string, orgId?: string) => {
  const [task] = orgId
    ? await db
        .select({ id: tasks.id, status: tasks.status, projectId: tasks.projectId, parentTaskId: tasks.parentTaskId })
        .from(tasks)
        .innerJoin(projects, eq(tasks.projectId, projects.id))
        .where(and(eq(tasks.id, id), eq(projects.orgId, orgId), isNull(tasks.deletedAt)))
    : await db
        .select({ id: tasks.id, status: tasks.status, projectId: tasks.projectId, parentTaskId: tasks.parentTaskId })
        .from(tasks)
        .where(and(eq(tasks.id, id), isNull(tasks.deletedAt)));

  if (!task) throw new AppError("Task not found", 404);

  if (task.status !== "completed") {
    throw new AppError("Only completed tasks can be deleted", 400);
  }

  await db.transaction(async (tx) => {
    await tx.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, id));
    // Cascade soft delete all subtasks of this task
    await tx.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.parentTaskId, id));
    await updateProjectStatusIfComplete(tx, task.projectId);
  });

  return { message: "Task deleted successfully" };
};
