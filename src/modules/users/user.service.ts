import bcrypt from "bcrypt";
import { db } from "../../config/db.js";
import { users, orgMembers, projectMembers, taskAssignees, tasks } from "../../../drizzle/schema.js";
import { eq, ilike, and, asc, desc, isNull, inArray, notInArray, count, sql } from "drizzle-orm";
import { AppError } from "../../utils/errors.js";

interface UserQuery {
  id?: string;
  name?: string;
  email?: string;
  role?: "superadmin" | "admin" | "developer";
  status?: "active" | "inactive";
  orgId?: string;
  projectId?: string;
  taskId?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  order?: string;
  unassigned?: boolean;
}

// ─── Create User ─────────────────────────────────────────────────────────────

export const createUser = async (
  data: { name: string; email: string; password: string; role: "admin" | "developer" },
  requester: { userId: string; role: "superadmin" | "admin" | "developer"; orgId?: string }
) => {
  // Admin can only create developers
  if (requester.role === "admin" && data.role !== "developer") {
    throw new AppError("Admins can only create developer accounts", 403);
  }

  // Check email uniqueness
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, data.email));
  if (existing) throw new AppError("Email already registered", 409);

  const passwordHash = await bcrypt.hash(data.password, 10);

  return await db.transaction(async (tx) => {
    const [newUser] = await tx
      .insert(users)
      .values({ name: data.name, email: data.email, passwordHash, role: data.role })
      .returning({ id: users.id, name: users.name, email: users.email, role: users.role, status: users.status });

    if (!newUser) throw new AppError("Failed to create user", 500);

    // Admin creating developer → auto-assign to admin's org
    if (requester.role === "admin") {
      if (!requester.orgId) throw new AppError("Admin has no organization", 403);
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

  // ─── Developer Scoping ───────────────────────────────────────────────────────
  // Developers can only see users within a specific project or task context.
  if (requesterRole === "developer" && requesterId) {
    if (taskId) {
      // Verify the developer is a member of the project this task belongs to
      const [taskRow] = await db
        .select({ projectId: tasks.projectId })
        .from(tasks)
        .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
        .limit(1);

      if (!taskRow) throw new AppError("Task not found", 404);

      const [membership] = await db
        .select({ userId: projectMembers.userId })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, taskRow.projectId), eq(projectMembers.userId, requesterId)))
        .limit(1);

      if (!membership) throw new AppError("You are not a member of this project", 403);

      // Scope to users assigned to this task only
      const assigneeSubquery = db
        .select({ userId: taskAssignees.userId })
        .from(taskAssignees)
        .where(eq(taskAssignees.taskId, taskId));

      filters.push(inArray(users.id, assigneeSubquery));

    } else if (projectId) {
      // Verify the developer is a member of this project
      const [membership] = await db
        .select({ userId: projectMembers.userId })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, requesterId)))
        .limit(1);

      if (!membership) throw new AppError("You are not a member of this project", 403);

      // Scope to members of this project only
      const projectMemberSubquery = db
        .select({ userId: projectMembers.userId })
        .from(projectMembers)
        .where(eq(projectMembers.projectId, projectId));

      filters.push(inArray(users.id, projectMemberSubquery));

    } else {
      // No project or task context — developer sees no one
      return { data: [], totalRecords: 0 };
    }

    // Apply standard filters after scoping (skip org/role filters for developer)
    if (id) filters.push(eq(users.id, id));
    if (name) filters.push(ilike(users.name, `%${name}%`));
    if (status) filters.push(eq(users.status, status));

    const whereCondition = and(...filters);
    const offset = (page - 1) * limit;

    const validColumns: Record<string, any> = { id: users.id, name: users.name, email: users.email, role: users.role, status: users.status, createdAt: users.createdAt };
    const orderColumn = validColumns[sortBy] || users.id;
    const orderDirection = order === "desc" ? desc(orderColumn) : asc(orderColumn);

    const data = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        status: users.status,
        phone: users.phone,
        avatarUrl: users.avatarUrl,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        projectCount: sql<number>`(
          SELECT COUNT(*) FROM project_members pm
          INNER JOIN projects p ON p.id = pm.project_id
          WHERE pm.user_id = "users"."id" AND p.deleted_at IS NULL
        )`.mapWith(Number),
        taskCount: sql<number>`(
          SELECT COUNT(*) FROM task_assignees ta
          INNER JOIN tasks t ON t.id = ta.task_id
          WHERE ta.user_id = "users"."id" AND t.deleted_at IS NULL
        )`.mapWith(Number),
        inProgressCount: sql<number>`(
          SELECT COUNT(*) FROM task_assignees ta
          INNER JOIN tasks t ON t.id = ta.task_id
          WHERE ta.user_id = "users"."id" AND t.status = 'in_progress' AND t.deleted_at IS NULL
        )`.mapWith(Number),
        toDoCount: sql<number>`(
          SELECT COUNT(*) FROM task_assignees ta
          INNER JOIN tasks t ON t.id = ta.task_id
          WHERE ta.user_id = "users"."id" AND t.status = 'to_do' AND t.deleted_at IS NULL
        )`.mapWith(Number),
      })
      .from(users)
      .where(whereCondition)
      .orderBy(orderDirection)
      .limit(limit)
      .offset(offset);

    const countResult = await db.select({ total: count() }).from(users).where(whereCondition);

    return { data, totalRecords: countResult[0]?.total ?? 0 };
  }

  // ─── Admin / Superadmin Scoping ──────────────────────────────────────────────
  const targetOrgId = contextOrgId || orgId;

  if (unassigned && requesterRole === "superadmin") {
    // Return users who are not a member of any organization
    const assignedSubquery = db.select({ userId: orgMembers.userId }).from(orgMembers);
    filters.push(notInArray(users.id, assignedSubquery));
  } else if (targetOrgId) {
    // Join with orgMembers to find users in this org
    const subquery = db
      .select({ userId: orgMembers.userId })
      .from(orgMembers)
      .where(eq(orgMembers.orgId, targetOrgId));

    filters.push(inArray(users.id, subquery));
  }

  // 2. Additional Filters
  if (id) filters.push(eq(users.id, id));
  if (name) filters.push(ilike(users.name, `%${name}%`));
  if (email) filters.push(ilike(users.email, `%${email}%`));
  if (role) filters.push(eq(users.role, role));
  if (status) filters.push(eq(users.status, status));

  const whereCondition = and(...filters);
  const offset = (page - 1) * limit;

  // 3. Sorting logic
  const validColumns: Record<string, any> = { id: users.id, name: users.name, email: users.email, role: users.role, status: users.status, createdAt: users.createdAt };
  const orderColumn = validColumns[sortBy] || users.id;
  const orderDirection = order === "desc" ? desc(orderColumn) : asc(orderColumn);

  const data = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      phone: users.phone,
      avatarUrl: users.avatarUrl,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      projectCount: sql<number>`(
        SELECT COUNT(*) FROM project_members pm
        INNER JOIN projects p ON p.id = pm.project_id
        WHERE pm.user_id = ${users.id} AND p.deleted_at IS NULL
      )`.mapWith(Number),
      taskCount: sql<number>`(
        SELECT COUNT(*) FROM task_assignees ta
        INNER JOIN tasks t ON t.id = ta.task_id
        WHERE ta.user_id = ${users.id} AND t.deleted_at IS NULL
      )`.mapWith(Number),
      inProgressCount: sql<number>`(
        SELECT COUNT(*) FROM task_assignees ta
        INNER JOIN tasks t ON t.id = ta.task_id
        WHERE ta.user_id = ${users.id} AND t.status = 'in_progress' AND t.deleted_at IS NULL
      )`.mapWith(Number),
      toDoCount: sql<number>`(
        SELECT COUNT(*) FROM task_assignees ta
        INNER JOIN tasks t ON t.id = ta.task_id
        WHERE ta.user_id = ${users.id} AND t.status = 'to_do' AND t.deleted_at IS NULL
      )`.mapWith(Number),
    })
    .from(users)
    .where(whereCondition)
    .orderBy(orderDirection)
    .limit(limit)
    .offset(offset);

  // 4. Count for pagination
  const countResult = await db
    .select({ total: count() })
    .from(users)
    .where(whereCondition);

  return { data, totalRecords: countResult[0]?.total ?? 0 };
};

// ─── Get User By ID ───────────────────────────────────────────────────────────

export const getUserById = async (userId: string, contextOrgId?: string) => {
  const filters = [eq(users.id, userId), isNull(users.deletedAt)];

  if (contextOrgId) {
    const subquery = db
      .select({ userId: orgMembers.userId })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, contextOrgId), eq(orgMembers.userId, userId)));
    
    const [membership] = await subquery;
    if (!membership) throw new AppError("User not found in your organization", 404);
  }

  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      phone: users.phone,
      avatarUrl: users.avatarUrl,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(and(...filters))
    .limit(1);

  if (!user) throw new AppError("User not found", 404);

  return user;
};

// ─── Update User Status (ADMIN only) ──────────────────────────────────────────

export const updateUserStatus = async (
  id: string,
  requesterId: string,
  status: "active" | "inactive",
  requesterRole: "superadmin" | "admin" | "developer",
  adminOrgId?: string
) => {
  // 1. Prevent self-deactivation
  if (id === requesterId && status === "inactive") {
    throw new AppError("You cannot deactivate your own account.", 400);
  }

  // 2. Admin must check org membership; superadmin skips this check
  if (requesterRole === "admin") {
    if (!adminOrgId) throw new AppError("Admin has no organization", 403);

    // Admins can only change status of developers — not other admins
    const [targetUser] = await db
      .select({ role: users.role })
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)));

    if (!targetUser) throw new AppError("User not found", 404);
    if (targetUser.role !== "developer") {
      throw new AppError("Admins can only change the status of developer accounts", 403);
    }

    const [membership] = await db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, adminOrgId), eq(orgMembers.userId, id)));

    if (!membership) {
      throw new AppError("You can only manage users within your own organization", 403);
    }
  }

  const [updated] = await db
    .update(users)
    .set({ status, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning({
      id: users.id,
      name: users.name,
      status: users.status
    });
  
  return updated;
};

// ─── Update User Profile ──────────────────────────────────────────────────────

export const updateUserProfile = async (id: string, data: any) => {
  const [updated] = await db
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      phone: users.phone,
      avatarUrl: users.avatarUrl,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    });

  return updated;
};
