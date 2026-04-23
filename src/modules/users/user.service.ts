import bcrypt from "bcrypt";
import { db } from "../../config/db.js";
import { users, orgMembers, organizations, projects, projectMembers, taskAssignees, tasks } from "../../db/schema/index.js";
import { eq, ilike, and, asc, desc, isNull, inArray, notInArray, count, sql } from "drizzle-orm";
import { deleteS3Object } from "../uploads/upload.service.js";
import { BadRequestException, ForbiddenException, NotFoundException, ConflictException, InternalServerException } from "../../exceptions/index.js";
import {
  ADMIN_DEVELOPER_ONLY, EMAIL_ALREADY_REGISTERED, USER_CREATE_FAILED, ADMIN_NO_ORG,
  TASK_NOT_FOUND, NOT_PROJECT_MEMBER, USER_NOT_IN_ORG, USER_NOT_FOUND,
  CANNOT_DEACTIVATE_SELF, ADMIN_DEVELOPER_STATUS_ONLY, WRONG_ORG_USER,
} from "../../constants/appMessages.js";
import type { PaginationQuery } from "../../types/common.types.js";

interface UserQuery extends PaginationQuery {
  id?: string; name?: string; email?: string;
  role?: "superadmin" | "admin" | "developer";
  status?: "active" | "inactive";
  orgId?: string; projectId?: string; taskId?: string;
  unassigned?: boolean;
}

// ─── Create User ─────────────────────────────────────────────────────────────

export const createUser = async (
  data: { name: string; email: string; password: string; role: "admin" | "developer" },
  requester: { userId: string; role: "superadmin" | "admin" | "developer"; orgId?: string }
) => {
  if (requester.role === "admin" && data.role !== "developer") {
    throw new ForbiddenException(ADMIN_DEVELOPER_ONLY);
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, data.email));
  if (existing) throw new ConflictException(EMAIL_ALREADY_REGISTERED);

  const passwordHash = await bcrypt.hash(data.password, 10);

  return await db.transaction(async (tx) => {
    const [newUser] = await tx
      .insert(users)
      .values({ name: data.name, email: data.email, passwordHash, role: data.role })
      .returning({ id: users.id, name: users.name, email: users.email, role: users.role, status: users.status });

    if (!newUser) throw new InternalServerException(USER_CREATE_FAILED);

    if (requester.role === "admin") {
      if (!requester.orgId) throw new ForbiddenException(ADMIN_NO_ORG);
      await tx.insert(orgMembers).values({ orgId: requester.orgId, userId: newUser.id, role: "developer" });
    }

    return newUser;
  });
};

// ─── Get Users (Scoped by Org / Project / Task) ──────────────────────────────

export const getUsers = async (
  query: UserQuery,
  contextOrgId?: string,
  requesterId?: string,
  requesterRole?: string
) => {
  const { id, name, email, role, status, orgId, projectId, taskId, unassigned, page = 1, limit = 10, sortBy = "id", order = "asc" } = query;

  const filters = [isNull(users.deletedAt)];

  if (requesterRole === "developer" && requesterId) {
    if (taskId) {
      const [taskRow] = await db
        .select({ projectId: tasks.projectId })
        .from(tasks)
        .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
        .limit(1);

      if (!taskRow) throw new NotFoundException(TASK_NOT_FOUND);

      const [membership] = await db
        .select({ userId: projectMembers.userId })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, taskRow.projectId), eq(projectMembers.userId, requesterId)))
        .limit(1);

      if (!membership) throw new ForbiddenException(NOT_PROJECT_MEMBER);

      filters.push(inArray(users.id, db.select({ userId: taskAssignees.userId }).from(taskAssignees).where(eq(taskAssignees.taskId, taskId))));
    } else if (projectId) {
      const [membership] = await db
        .select({ userId: projectMembers.userId })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, requesterId)))
        .limit(1);

      if (!membership) throw new ForbiddenException(NOT_PROJECT_MEMBER);

      filters.push(inArray(users.id, db.select({ userId: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, projectId))));
    } else {
      return { data: [], totalRecords: 0 };
    }

    if (id) filters.push(eq(users.id, id));
    if (name) filters.push(ilike(users.name, `%${name}%`));
    if (status) filters.push(eq(users.status, status));

    const whereCondition = and(...filters);
    const offset = (page - 1) * limit;
    const sortColumns = { id: users.id, name: users.name, email: users.email, role: users.role, status: users.status, createdAt: users.createdAt } as const;
    type SortKey = keyof typeof sortColumns;
    const orderColumn = (sortBy && sortBy in sortColumns) ? sortColumns[sortBy as SortKey] : users.id;
    const orderDirection = order === "desc" ? desc(orderColumn) : asc(orderColumn);

    const data = await db.select({
      id: users.id, name: users.name, email: users.email, role: users.role, status: users.status,
      phone: users.phone, avatarUrl: users.avatarUrl, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt,
      orgId: orgMembers.orgId, orgName: organizations.name,
      projectCount: sql<number>`(SELECT COUNT(*) FROM project_members pm INNER JOIN projects p ON p.id = pm.project_id WHERE pm.user_id = "users"."id" AND p.deleted_at IS NULL)`.mapWith(Number),
      taskCount: sql<number>`(SELECT COUNT(*) FROM task_assignees ta INNER JOIN tasks t ON t.id = ta.task_id WHERE ta.user_id = "users"."id" AND t.deleted_at IS NULL AND t.parent_task_id IS NULL)`.mapWith(Number),
      inProgressCount: sql<number>`(SELECT COUNT(*) FROM task_assignees ta INNER JOIN tasks t ON t.id = ta.task_id WHERE ta.user_id = "users"."id" AND t.status = 'in_progress' AND t.deleted_at IS NULL AND t.parent_task_id IS NULL)`.mapWith(Number),
      toDoCount: sql<number>`(SELECT COUNT(*) FROM task_assignees ta INNER JOIN tasks t ON t.id = ta.task_id WHERE ta.user_id = "users"."id" AND t.status = 'to_do' AND t.deleted_at IS NULL AND t.parent_task_id IS NULL)`.mapWith(Number),
    }).from(users)
      .leftJoin(orgMembers, eq(users.id, orgMembers.userId))
      .leftJoin(organizations, eq(orgMembers.orgId, organizations.id))
      .where(whereCondition).orderBy(orderDirection).limit(limit).offset(offset);

    const countResult = await db.select({ total: count() }).from(users).where(whereCondition);
    return { data, totalRecords: countResult[0]?.total ?? 0 };
  }

  // ─── Admin / Superadmin Scoping ───────────────────────────────────────────────
  const targetOrgId = contextOrgId || orgId;

  if (unassigned && requesterRole === "superadmin") {
    filters.push(notInArray(users.id, db.select({ userId: orgMembers.userId }).from(orgMembers)));
  } else if (targetOrgId) {
    filters.push(inArray(users.id, db.select({ userId: orgMembers.userId }).from(orgMembers).where(eq(orgMembers.orgId, targetOrgId))));
  }

  if (id) filters.push(eq(users.id, id));
  if (name) filters.push(ilike(users.name, `%${name}%`));
  if (email) filters.push(ilike(users.email, `%${email}%`));
  if (role) filters.push(eq(users.role, role));
  if (status) filters.push(eq(users.status, status));

  const whereCondition = and(...filters);
  const offset = (page - 1) * limit;
  const sortColumns = { id: users.id, name: users.name, email: users.email, role: users.role, status: users.status, createdAt: users.createdAt } as const;
  type SortKey = keyof typeof sortColumns;
  const orderColumn = (sortBy && sortBy in sortColumns) ? sortColumns[sortBy as SortKey] : users.id;
  const orderDirection = order === "desc" ? desc(orderColumn) : asc(orderColumn);

  const data = await db.select({
    id: users.id, name: users.name, email: users.email, role: users.role, status: users.status,
    phone: users.phone, avatarUrl: users.avatarUrl, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt,
    orgId: orgMembers.orgId, orgName: organizations.name,
    projectCount: sql<number>`(SELECT COUNT(*) FROM project_members pm INNER JOIN projects p ON p.id = pm.project_id WHERE pm.user_id = "users"."id" AND p.deleted_at IS NULL)`.mapWith(Number),
    taskCount: sql<number>`(SELECT COUNT(*) FROM task_assignees ta INNER JOIN tasks t ON t.id = ta.task_id WHERE ta.user_id = "users"."id" AND t.deleted_at IS NULL AND t.parent_task_id IS NULL)`.mapWith(Number),
    inProgressCount: sql<number>`(SELECT COUNT(*) FROM task_assignees ta INNER JOIN tasks t ON t.id = ta.task_id WHERE ta.user_id = "users"."id" AND t.status = 'in_progress' AND t.deleted_at IS NULL AND t.parent_task_id IS NULL)`.mapWith(Number),
    toDoCount: sql<number>`(SELECT COUNT(*) FROM task_assignees ta INNER JOIN tasks t ON t.id = ta.task_id WHERE ta.user_id = "users"."id" AND t.status = 'to_do' AND t.deleted_at IS NULL AND t.parent_task_id IS NULL)`.mapWith(Number),
  }).from(users)
    .leftJoin(orgMembers, eq(users.id, orgMembers.userId))
    .leftJoin(organizations, eq(orgMembers.orgId, organizations.id))
    .where(whereCondition).orderBy(orderDirection).limit(limit).offset(offset);

  const countResult = await db.select({ total: count() }).from(users).where(whereCondition);
  return { data, totalRecords: countResult[0]?.total ?? 0 };
};

// ─── Get User By ID ───────────────────────────────────────────────────────────

export const getUserById = async (userId: string, contextOrgId?: string) => {
  if (contextOrgId) {
    const [membership] = await db
      .select({ userId: orgMembers.userId })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, contextOrgId), eq(orgMembers.userId, userId)));

    if (!membership) throw new NotFoundException(USER_NOT_IN_ORG);
  }

  const [user] = await db
    .select({
      id: users.id, name: users.name, email: users.email, role: users.role, status: users.status,
      phone: users.phone, avatarUrl: users.avatarUrl, lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt, updatedAt: users.updatedAt,
      orgId: orgMembers.orgId, orgName: organizations.name,
    })
    .from(users)
    .leftJoin(orgMembers, eq(users.id, orgMembers.userId))
    .leftJoin(organizations, eq(orgMembers.orgId, organizations.id))
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);

  if (!user) throw new NotFoundException(USER_NOT_FOUND);

  // Fetch projects, tasks, and stats in parallel
  const [userProjects, userTasks, taskStats] = await Promise.all([
    // Projects the user is a member of
    db
      .select({
        id: projects.id,
        title: projects.title,
        description: projects.description,
        logoUrl: projects.logoUrl,
        status: projects.status,
        createdAt: projects.createdAt,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projectMembers.projectId, projects.id))
      .where(and(eq(projectMembers.userId, userId), isNull(projects.deletedAt))),

    // Tasks assigned to the user (top-level only)
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        dueDate: tasks.dueDate,
        projectId: tasks.projectId,
        completedAt: tasks.completedAt,
        createdAt: tasks.createdAt,
      })
      .from(taskAssignees)
      .innerJoin(tasks, eq(taskAssignees.taskId, tasks.id))
      .where(and(eq(taskAssignees.userId, userId), isNull(tasks.deletedAt), isNull(tasks.parentTaskId))),

    // Aggregate task stats
    db
      .select({
        total: count(),
        completed: sql<number>`COUNT(CASE WHEN ${tasks.status} = 'completed' THEN 1 END)`.mapWith(Number),
        pending: sql<number>`COUNT(CASE WHEN ${tasks.status} = 'to_do' THEN 1 END)`.mapWith(Number),
        inProgress: sql<number>`COUNT(CASE WHEN ${tasks.status} = 'in_progress' THEN 1 END)`.mapWith(Number),
        onHold: sql<number>`COUNT(CASE WHEN ${tasks.status} = 'on_hold' THEN 1 END)`.mapWith(Number),
        overdue: sql<number>`COUNT(CASE WHEN ${tasks.status} = 'overdue' THEN 1 END)`.mapWith(Number),
        onTime: sql<number>`COUNT(CASE WHEN ${tasks.status} = 'completed' AND (${tasks.dueDate} IS NULL OR ${tasks.completedAt} <= ${tasks.dueDate}::timestamp) THEN 1 END)`.mapWith(Number),
        offTime: sql<number>`COUNT(CASE WHEN ${tasks.status} = 'completed' AND ${tasks.dueDate} IS NOT NULL AND ${tasks.completedAt} > ${tasks.dueDate}::timestamp THEN 1 END)`.mapWith(Number),
      })
      .from(taskAssignees)
      .innerJoin(tasks, eq(taskAssignees.taskId, tasks.id))
      .where(and(eq(taskAssignees.userId, userId), isNull(tasks.deletedAt), isNull(tasks.parentTaskId))),
  ]);

  const stats = taskStats[0] ?? { total: 0, completed: 0, pending: 0, inProgress: 0, onHold: 0, overdue: 0, onTime: 0, offTime: 0 };

  // Fetch all assignees for the user's tasks
  const taskIds = userTasks.map((t) => t.id);
  const allAssignees = taskIds.length > 0
    ? await db
        .select({
          taskId: taskAssignees.taskId,
          id: users.id,
          name: users.name,
          email: users.email,
          avatarUrl: users.avatarUrl,
        })
        .from(taskAssignees)
        .innerJoin(users, eq(taskAssignees.userId, users.id))
        .where(inArray(taskAssignees.taskId, taskIds))
    : [];

  // Map assignees by taskId
  const assigneesByTask = new Map<string, { id: string; name: string; email: string; avatarUrl: string | null }[]>();
  for (const assignee of allAssignees) {
    const existing = assigneesByTask.get(assignee.taskId) ?? [];
    existing.push({ id: assignee.id, name: assignee.name, email: assignee.email, avatarUrl: assignee.avatarUrl });
    assigneesByTask.set(assignee.taskId, existing);
  }

  // Attach assignees to each task
  const tasksWithAssignees = userTasks.map((task) => ({
    ...task,
    assignees: assigneesByTask.get(task.id) ?? [],
  }));

  // Group tasks under their respective project
  const tasksByProject = new Map<string, typeof tasksWithAssignees>();
  for (const task of tasksWithAssignees) {
    const existing = tasksByProject.get(task.projectId) ?? [];
    existing.push(task);
    tasksByProject.set(task.projectId, existing);
  }

  const projectsWithTasks = userProjects.map((project) => ({
    ...project,
    tasks: tasksByProject.get(project.id) ?? [],
  }));

  return {
    ...user,
    stats: {
      totalProjects: userProjects.length,
      totalTasks: stats.total,
      completed: stats.completed,
      pending: stats.pending,
      inProgress: stats.inProgress,
      onHold: stats.onHold,
      overdue: stats.overdue,
      onTime: stats.onTime,
      offTime: stats.offTime,
    },
    projects: projectsWithTasks,
  };
};

// ─── Update User Status ───────────────────────────────────────────────────────

export const updateUserStatus = async (
  id: string,
  requesterId: string,
  status: "active" | "inactive",
  requesterRole: "superadmin" | "admin" | "developer",
  adminOrgId?: string
) => {
  if (id === requesterId && status === "inactive") throw new BadRequestException(CANNOT_DEACTIVATE_SELF);

  if (requesterRole === "admin") {
    if (!adminOrgId) throw new ForbiddenException(ADMIN_NO_ORG);

    const [targetUser] = await db
      .select({ role: users.role })
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)));

    if (!targetUser) throw new NotFoundException(USER_NOT_FOUND);
    if (targetUser.role !== "developer") throw new ForbiddenException(ADMIN_DEVELOPER_STATUS_ONLY);

    const [membership] = await db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, adminOrgId), eq(orgMembers.userId, id)));

    if (!membership) throw new ForbiddenException(WRONG_ORG_USER);
  }

  const [updated] = await db
    .update(users)
    .set({ status, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning({ id: users.id, name: users.name, status: users.status });

  return updated;
};

// ─── Update User Profile ──────────────────────────────────────────────────────

interface ProfileUpdate {
  name?: string;
  phone?: string;
  avatarUrl?: string;
}

export const updateUserProfile = async (id: string, data: ProfileUpdate) => {
  // If avatarUrl is being replaced, delete the old file from B2
  if (data.avatarUrl !== undefined) {
    const [current] = await db.select({ avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, id));
    if (current?.avatarUrl) await deleteS3Object(current.avatarUrl);
  }

  const [updated] = await db
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning({
      id: users.id, name: users.name, email: users.email, role: users.role, status: users.status,
      phone: users.phone, avatarUrl: users.avatarUrl, lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt, updatedAt: users.updatedAt,
    });

  return updated;
};
