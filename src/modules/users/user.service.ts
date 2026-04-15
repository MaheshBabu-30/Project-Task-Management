import bcrypt from "bcrypt";
import { db } from "../../config/db.js";
import { users, orgMembers } from "../../../drizzle/schema.js";
import { eq, ilike, and, asc, desc, isNull, inArray, count } from "drizzle-orm";
import { AppError } from "../../utils/errors.js";

interface UserQuery {
  id?: string;
  name?: string;
  email?: string;
  role?: "superadmin" | "admin" | "developer";
  status?: "active" | "inactive";
  orgId?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  order?: string;
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

// ─── Get Users (Scoped by Org) ────────────────────────────────────────────────

export const getUsers = async (query: UserQuery, contextOrgId?: string) => {
  const { id, name, email, role, status, orgId, page = 1, limit = 10, sortBy = "id", order = "asc" } = query;

  const filters = [isNull(users.deletedAt)];

  // 1. Scoping Logic
  const targetOrgId = contextOrgId || orgId;

  if (targetOrgId) {
    // Join with orgMembers to find users in this org
    const subquery = db
      .select({ userId: orgMembers.userId })
      .from(orgMembers)
      .where(eq(orgMembers.orgId, targetOrgId));
    
    // We add an IN clause to the main user query
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
      createdAt: users.createdAt
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
