import { db } from "../../config/db.js";
import { tasks, projects, taskAssignees, projectMembers, orgMembers, users, organizations } from "../../db/schema/index.js";
import { eq, and, isNull, inArray, count, sql } from "drizzle-orm";
import { BadRequestException, ForbiddenException, NotFoundException, InternalServerException } from "../../exceptions/index.js";
import * as M from "../../constants/appMessages.js";
import type { TaskStatus, TaskPriority } from "../../types/task.types.js";
import type { ImportTasksBody, ImportProjectBody } from "./data-transfer.schema.js";

type User = { userId: string; role: string; orgId?: string };

// ─── Access Guards ────────────────────────────────────────────────────────────

const validateProjectAccess = async (projectId: string, user: User) => {
  const [project] = await db
    .select({
      id: projects.id,
      orgId: projects.orgId,
      title: projects.title,
      description: projects.description,
      status: projects.status,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)));

  if (!project) throw new NotFoundException(M.PROJECT_NOT_FOUND);
  if (user.role !== "superadmin" && project.orgId !== user.orgId)
    throw new ForbiddenException(M.PROJECT_WRONG_ORG);

  return project;
};

const validateOrgAccess = async (orgId: string, user: User) => {
  const [org] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)));

  if (!org) throw new NotFoundException(M.ORG_NOT_FOUND);
  if (user.role !== "superadmin" && orgId !== user.orgId)
    throw new ForbiddenException(M.ACCESS_DENIED);

  return org;
};

// ─── Project Status Reconciliation ───────────────────────────────────────────

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const reconcileProjectStatus = async (tx: DbTx, projectId: string) => {
  const [counts] = await tx
    .select({
      total: count(),
      pending: sql<number>`COUNT(CASE WHEN ${tasks.status} != 'completed' THEN 1 END)`.mapWith(Number),
    })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt), isNull(tasks.parentTaskId)));

  const total = counts?.total ?? 0;
  const pending = counts?.pending ?? 0;

  if (total > 0 && pending === 0) {
    await tx.update(projects).set({ status: "completed" }).where(eq(projects.id, projectId));
  } else {
    const [proj] = await tx.select({ status: projects.status }).from(projects).where(eq(projects.id, projectId));
    if (proj?.status === "completed") {
      await tx.update(projects).set({ status: "active" }).where(eq(projects.id, projectId));
    }
  }
};

// ─── Shared Export Helper ─────────────────────────────────────────────────────

const fetchTaskTree = async (projectId: string) => {
  const rootTasks = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
    })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), isNull(tasks.parentTaskId), isNull(tasks.deletedAt)));

  if (rootTasks.length === 0) return [];

  const rootTaskIds = rootTasks.map((t) => t.id);

  const subtasks = await db
    .select({
      id: tasks.id,
      parentTaskId: tasks.parentTaskId,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
    })
    .from(tasks)
    .where(and(inArray(tasks.parentTaskId, rootTaskIds), isNull(tasks.deletedAt)));

  const subtaskIds = subtasks.map((s) => s.id);
  const allTaskIds = [...rootTaskIds, ...subtaskIds];

  const allAssignees = await db
    .select({ taskId: taskAssignees.taskId, email: users.email })
    .from(taskAssignees)
    .innerJoin(users, eq(taskAssignees.userId, users.id))
    .where(and(inArray(taskAssignees.taskId, allTaskIds), isNull(users.deletedAt)));

  const assigneeMap: Record<string, string[]> = {};
  allAssignees.forEach((a) => {
    if (!a.taskId) return;
    if (!assigneeMap[a.taskId]) assigneeMap[a.taskId] = [];
    assigneeMap[a.taskId]!.push(a.email);
  });

  const subtaskMap: Record<string, typeof subtasks> = {};
  subtasks.forEach((s) => {
    if (!s.parentTaskId) return;
    if (!subtaskMap[s.parentTaskId]) subtaskMap[s.parentTaskId] = [];
    subtaskMap[s.parentTaskId]!.push(s);
  });

  const fmtDate = (d: Date | null) => (d ? d.toISOString().split("T")[0] : null);

  return rootTasks.map((t) => ({
    title: t.title,
    description: t.description ?? null,
    status: t.status,
    priority: t.priority,
    dueDate: fmtDate(t.dueDate),
    assigneeEmails: assigneeMap[t.id] ?? [],
    subtasks: (subtaskMap[t.id] ?? []).map((s) => ({
      title: s.title,
      description: s.description ?? null,
      status: s.status,
      priority: s.priority,
      dueDate: fmtDate(s.dueDate),
      assigneeEmails: assigneeMap[s.id] ?? [],
    })),
  }));
};

// ─── Shared Import Helper ─────────────────────────────────────────────────────

const resolveEmailsToUserIds = async (orgId: string, emails: string[]): Promise<Record<string, string>> => {
  if (emails.length === 0) return {};

  const members = await db
    .select({ userId: orgMembers.userId, email: users.email })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(
      and(
        eq(orgMembers.orgId, orgId),
        eq(orgMembers.role, "developer"),
        inArray(users.email, emails),
        isNull(users.deletedAt),
      ),
    );

  const map: Record<string, string> = {};
  members.forEach((m) => { map[m.email] = m.userId; });
  return map;
};

// ─── Exports ──────────────────────────────────────────────────────────────────

export const exportProjectTasks = async (projectId: string, user: User) => {
  const project = await validateProjectAccess(projectId, user);
  const taskTree = await fetchTaskTree(projectId);

  return {
    exportedAt: new Date().toISOString(),
    projectId: project.id,
    projectTitle: project.title,
    totalTasks: taskTree.length,
    tasks: taskTree,
  };
};

export const exportFullProject = async (projectId: string, user: User) => {
  const project = await validateProjectAccess(projectId, user);
  const taskTree = await fetchTaskTree(projectId);

  return {
    exportedAt: new Date().toISOString(),
    project: {
      title: project.title,
      description: project.description ?? null,
      status: project.status,
    },
    totalTasks: taskTree.length,
    tasks: taskTree,
  };
};

export const exportOrgMembers = async (orgId: string, user: User) => {
  const org = await validateOrgAccess(orgId, user);

  const members = await db
    .select({
      name: users.name,
      email: users.email,
      role: orgMembers.role,
      joinedAt: orgMembers.joinedAt,
    })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(and(eq(orgMembers.orgId, orgId), isNull(users.deletedAt)));

  return {
    exportedAt: new Date().toISOString(),
    orgId: org.id,
    orgName: org.name,
    totalMembers: members.length,
    members: members.map((m) => ({
      name: m.name,
      email: m.email,
      role: m.role,
      joinedAt: m.joinedAt?.toISOString() ?? null,
    })),
  };
};

// ─── Imports ──────────────────────────────────────────────────────────────────

export const importTasksIntoProject = async (
  projectId: string,
  taskList: ImportTasksBody["tasks"],
  user: User,
) => {
  const project = await validateProjectAccess(projectId, user);
  const orgId = project.orgId;

  const allEmails = [
    ...new Set(
      taskList.flatMap((t) => [
        ...(t.assigneeEmails ?? []),
        ...(t.subtasks ?? []).flatMap((s) => s.assigneeEmails ?? []),
      ]),
    ),
  ];
  const emailToUserId = await resolveEmailsToUserIds(orgId, allEmails);

  let taskCount = 0;
  let subtaskCount = 0;

  // Validate business rules before touching the DB
  for (const taskData of taskList) {
    if (taskData.status === "completed") {
      const incomplete = (taskData.subtasks ?? []).filter((s) => (s.status ?? "to_do") !== "completed");
      if (incomplete.length > 0) {
        throw new BadRequestException(
          `Task "${taskData.title}": cannot import as completed — ${incomplete.length} subtask(s) are not completed`,
        );
      }
    }
  }

  await db.transaction(async (tx) => {
    for (const taskData of taskList) {
      const assigneeIds = [
        ...new Set(
          (taskData.assigneeEmails ?? [])
            .map((e) => emailToUserId[e])
            .filter((id): id is string => !!id),
        ),
      ];

      const taskStatus = (taskData.status ?? "to_do") as TaskStatus;
      const [task] = await tx
        .insert(tasks)
        .values({
          projectId,
          title: taskData.title,
          description: taskData.description ?? null,
          priority: (taskData.priority ?? "medium") as TaskPriority,
          status: taskStatus,
          completedAt: taskStatus === "completed" ? new Date() : null,
          dueDate: taskData.dueDate ? new Date(taskData.dueDate) : null,
          createdBy: user.userId,
        })
        .returning({ id: tasks.id });

      if (!task) throw new InternalServerException(M.TASK_CREATE_FAILED);
      taskCount++;

      if (assigneeIds.length > 0) {
        await tx.insert(taskAssignees).values(assigneeIds.map((userId) => ({ taskId: task.id, userId })));
        await tx.insert(projectMembers).values(assigneeIds.map((userId) => ({ projectId, userId }))).onConflictDoNothing();
      }

      for (const subtask of taskData.subtasks ?? []) {
        const stAssigneeIds = [
          ...new Set(
            (subtask.assigneeEmails ?? [])
              .map((e) => emailToUserId[e])
              .filter((id): id is string => !!id),
          ),
        ];

        const subtaskStatus = (subtask.status ?? "to_do") as TaskStatus;
        const [st] = await tx
          .insert(tasks)
          .values({
            projectId,
            parentTaskId: task.id,
            title: subtask.title,
            description: subtask.description ?? null,
            priority: (subtask.priority ?? "medium") as TaskPriority,
            status: subtaskStatus,
            completedAt: subtaskStatus === "completed" ? new Date() : null,
            dueDate: subtask.dueDate ? new Date(subtask.dueDate) : null,
            createdBy: user.userId,
          })
          .returning({ id: tasks.id });

        if (!st) throw new InternalServerException(M.TASK_CREATE_FAILED);
        subtaskCount++;

        if (stAssigneeIds.length > 0) {
          await tx.insert(taskAssignees).values(stAssigneeIds.map((userId) => ({ taskId: st.id, userId })));
          await tx.insert(projectMembers).values(stAssigneeIds.map((userId) => ({ projectId, userId }))).onConflictDoNothing();
        }
      }
    }

    await reconcileProjectStatus(tx, projectId);
  });

  return { tasksImported: taskCount, subtasksImported: subtaskCount };
};

export const importProjectIntoOrg = async (
  orgId: string,
  data: ImportProjectBody,
  user: User,
) => {
  await validateOrgAccess(orgId, user);

  const taskList = data.tasks ?? [];

  const allEmails = [
    ...new Set(
      taskList.flatMap((t) => [
        ...(t.assigneeEmails ?? []),
        ...(t.subtasks ?? []).flatMap((s) => s.assigneeEmails ?? []),
      ]),
    ),
  ];
  const emailToUserId = await resolveEmailsToUserIds(orgId, allEmails);

  // Validate business rules before touching the DB
  for (const taskData of taskList) {
    if (taskData.status === "completed") {
      const incomplete = (taskData.subtasks ?? []).filter((s) => (s.status ?? "to_do") !== "completed");
      if (incomplete.length > 0) {
        throw new BadRequestException(
          `Task "${taskData.title}": cannot import as completed — ${incomplete.length} subtask(s) are not completed`,
        );
      }
    }
  }

  let taskCount = 0;
  let subtaskCount = 0;
  let createdProjectId = "";

  await db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({
        orgId,
        title: data.project.title,
        description: data.project.description ?? null,
        status: (data.project.status ?? "active") as "active" | "on_hold" | "completed",
        createdBy: user.userId,
      })
      .returning({ id: projects.id });

    if (!project) throw new InternalServerException(M.PROJECT_CREATE_FAILED);
    createdProjectId = project.id;

    for (const taskData of taskList) {
      const assigneeIds = [
        ...new Set(
          (taskData.assigneeEmails ?? [])
            .map((e) => emailToUserId[e])
            .filter((id): id is string => !!id),
        ),
      ];

      const taskStatus = (taskData.status ?? "to_do") as TaskStatus;
      const [task] = await tx
        .insert(tasks)
        .values({
          projectId: project.id,
          title: taskData.title,
          description: taskData.description ?? null,
          priority: (taskData.priority ?? "medium") as TaskPriority,
          status: taskStatus,
          completedAt: taskStatus === "completed" ? new Date() : null,
          dueDate: taskData.dueDate ? new Date(taskData.dueDate) : null,
          createdBy: user.userId,
        })
        .returning({ id: tasks.id });

      if (!task) throw new InternalServerException(M.TASK_CREATE_FAILED);
      taskCount++;

      if (assigneeIds.length > 0) {
        await tx.insert(taskAssignees).values(assigneeIds.map((userId) => ({ taskId: task.id, userId })));
        await tx.insert(projectMembers).values(assigneeIds.map((userId) => ({ projectId: project.id, userId }))).onConflictDoNothing();
      }

      for (const subtask of taskData.subtasks ?? []) {
        const stAssigneeIds = [
          ...new Set(
            (subtask.assigneeEmails ?? [])
              .map((e) => emailToUserId[e])
              .filter((id): id is string => !!id),
          ),
        ];

        const subtaskStatus = (subtask.status ?? "to_do") as TaskStatus;
        const [st] = await tx
          .insert(tasks)
          .values({
            projectId: project.id,
            parentTaskId: task.id,
            title: subtask.title,
            description: subtask.description ?? null,
            priority: (subtask.priority ?? "medium") as TaskPriority,
            status: subtaskStatus,
            completedAt: subtaskStatus === "completed" ? new Date() : null,
            dueDate: subtask.dueDate ? new Date(subtask.dueDate) : null,
            createdBy: user.userId,
          })
          .returning({ id: tasks.id });

        if (!st) throw new InternalServerException(M.TASK_CREATE_FAILED);
        subtaskCount++;

        if (stAssigneeIds.length > 0) {
          await tx.insert(taskAssignees).values(stAssigneeIds.map((userId) => ({ taskId: st.id, userId })));
          await tx.insert(projectMembers).values(stAssigneeIds.map((userId) => ({ projectId: project.id, userId }))).onConflictDoNothing();
        }
      }
    }

    if (taskList.length > 0) {
      await reconcileProjectStatus(tx, createdProjectId);
    }
  });

  return {
    projectId: createdProjectId,
    projectTitle: data.project.title,
    tasksImported: taskCount,
    subtasksImported: subtaskCount,
  };
};
