import { db } from "../../config/db.js";
import { tasks, projects, taskAssignees, users } from "../../../drizzle/schema.js";
import { eq, and, ilike, asc, desc, inArray, isNull, notInArray } from "drizzle-orm";
import { AppError } from "../../utils/errors.js";

interface TaskQuery {
  id?: string;
  status?: "to_do" | "in_progress" | "on_hold" | "overdue" | "completed";
  priority?: "low" | "medium" | "high" | "urgent";
  search?: string;
  projectId?: string;
  assignedUserId?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  order?: string;
  showDeleted?: boolean;
}

// ─── Helper: Update Project Status ───────────────────────────────────────────

const updateProjectStatusIfComplete = async (tx: any, projectId: string) => {
  // Check if all tasks in this project are completed
  const pendingTasks = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(
      eq(tasks.projectId, projectId),
      isNull(tasks.deletedAt),
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
  createdBy: string;
  assignedUserIds?: string[];
}) => {
  const { assignedUserIds, ...taskData } = data;

  return await db.transaction(async (tx) => {
    // 1. Verify Project belongs to user's org (checked in controller)
    
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
      const assignEntries = assignedUserIds.map((userId) => ({
        taskId: task.id,
        userId: userId,
      }));
      await tx.insert(taskAssignees).values(assignEntries);
    }

    // 4. Update project status (new task means project might no longer be 'completed')
    if (task) {
      await updateProjectStatusIfComplete(tx, task.projectId);
    }

    return task;
  });
};

// ─── Get Tasks (Scoped) ───────────────────────────────────────────────────────

export const getTasks = async (
  query: TaskQuery,
  user: { userId: string; role: string; orgId?: string }
) => {
  const { id, status, priority, search, projectId, assignedUserId, page = 1, limit = 10, sortBy = "id", order = "asc", showDeleted = false } = query;

  const filters = [showDeleted ? notInArray(tasks.deletedAt, [null as any]) : isNull(tasks.deletedAt)];

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
  const columnMap: Record<string, any> = {
    id: tasks.id,
    title: tasks.title,
    status: tasks.status,
    priority: tasks.priority,
    dueDate: tasks.dueDate,
    createdAt: tasks.createdAt
  };
  const orderColumn = columnMap[sortBy] || tasks.id;
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
  let assigneesMap: Record<string, any[]> = {};

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

  const dataWithAssignees = data.map((task) => ({
    ...task,
    assignees: assigneesMap[task.id] || [],
  }));

  const totalResult = await db
    .select({ count: tasks.id })
    .from(tasks)
    .where(whereCondition);

  return { data: dataWithAssignees, totalRecords: totalResult.length };
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

  return { ...task, assignees };
};

// ─── Update Task ──────────────────────────────────────────────────────────────

export const updateTask = async (id: string, data: any, orgId: string) => {
  const { assignedUserIds, ...updateData } = data;

  return await db.transaction(async (tx) => {
    // 1. Check if task belongs to org
    const [task] = await tx
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(and(eq(tasks.id, id), eq(projects.orgId, orgId), isNull(tasks.deletedAt)));

    if (!task) throw new AppError("Task not found or access denied", 404);

    // 2. Update Task
    const preparedData = { ...updateData };
    if (data.dueDate) preparedData.dueDate = data.dueDate;
    preparedData.updatedAt = new Date();

    const [updated] = await tx
      .update(tasks)
      .set(preparedData)
      .where(eq(tasks.id, id))
      .returning();

    if (!updated) throw new AppError("Task not found or access denied", 404);

    // 3. Sync Assignees
    if (assignedUserIds) {
      await tx.delete(taskAssignees).where(eq(taskAssignees.taskId, id));
      if (assignedUserIds.length > 0) {
        const assignEntries = assignedUserIds.map((userId: string) => ({
          taskId: id,
          userId: userId,
        }));
        await tx.insert(taskAssignees).values(assignEntries);
      }
    }

    // 4. Update Project Status if task status changed to 'completed'
    if (data.status) {
      await updateProjectStatusIfComplete(tx, updated.projectId);
    }

    return updated;
  });
};

// ─── Soft Delete Task ────────────────────────────────────────────────────────

export const softDeleteTask = async (id: string, orgId: string) => {
  const [task] = await db
    .select({ id: tasks.id, status: tasks.status, projectId: tasks.projectId })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(eq(tasks.id, id), eq(projects.orgId, orgId), isNull(tasks.deletedAt)));

  if (!task) throw new AppError("Task not found", 404);

  if (task.status !== "completed") {
    throw new AppError("Only completed tasks can be archived", 400);
  }

  await db.transaction(async (tx) => {
    await tx.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, id));
    await updateProjectStatusIfComplete(tx, task.projectId);
  });

  return { message: "Task archived successfully" };
};
