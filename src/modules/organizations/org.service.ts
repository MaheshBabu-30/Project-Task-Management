import { db } from "../../config/db.js";
import { organizations, orgMembers, users, projects, projectMembers, taskAssignees, tasks, sessions } from "../../../drizzle/schema.js";
import { eq, and, isNull, inArray, ilike, asc, desc, count } from "drizzle-orm";
import { AppError } from "../../utils/errors.js";

// ─── Create Organization ──────────────────────────────────────────────────────

export const createOrganization = async (data: {
  name: string;
  slug: string;
}) => {
  // Check slug uniqueness
  const [existing] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, data.slug));

  if (existing) {
    throw new AppError(`Slug "${data.slug}" is already taken. Choose a different slug.`, 409);
  }

  const [org] = await db
    .insert(organizations)
    .values({ name: data.name, slug: data.slug })
    .returning();

  return org;
};

// ─── Get All Organizations (SUPERADMIN) ───────────────────────────────────────

export const getAllOrganizations = async (query?: {
  name?: string;
  slug?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  order?: string;
}) => {
  const { name, slug, page = 1, limit = 20, sortBy = "createdAt", order = "asc" } = query ?? {};
  const offset = (page - 1) * limit;

  const conditions = [isNull(organizations.deletedAt)];
  if (name) conditions.push(ilike(organizations.name, `%${name}%`));
  if (slug) conditions.push(ilike(organizations.slug, `%${slug}%`));

  const whereCondition = and(...conditions);

  const validColumns: Record<string, any> = {
    id: organizations.id,
    name: organizations.name,
    slug: organizations.slug,
    createdAt: organizations.createdAt,
  };
  const orderColumn = validColumns[sortBy] ?? organizations.createdAt;
  const orderDirection = order === "desc" ? desc(orderColumn) : asc(orderColumn);

  const [orgs, countResult] = await Promise.all([
    db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        ownerId: organizations.ownerId,
        createdAt: organizations.createdAt,
      })
      .from(organizations)
      .where(whereCondition)
      .orderBy(orderDirection)
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(organizations).where(whereCondition),
  ]);

  return { data: orgs, totalRecords: countResult[0]?.total ?? 0 };
};

// ─── Get Organization By ID ───────────────────────────────────────────────────

export const softDeleteOrg = async (orgId: string, deletedBy: string) => {
  const [org] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)));

  if (!org) throw new AppError("Organization not found", 404);

  const now = new Date();

  const updated = await db.transaction(async (tx) => {
    // 1. Get all members to revoke their sessions
    const members = await tx
      .select({ userId: orgMembers.userId })
      .from(orgMembers)
      .where(eq(orgMembers.orgId, orgId));

    const memberIds = members.map((m) => m.userId);

    // 2. Get all projects to cascade to tasks
    const orgProjects = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.orgId, orgId), isNull(projects.deletedAt)));

    const projectIds = orgProjects.map((p) => p.id);

    // 3. Soft-delete all tasks in those projects
    if (projectIds.length > 0) {
      await tx
        .update(tasks)
        .set({ deletedAt: now })
        .where(and(inArray(tasks.projectId, projectIds), isNull(tasks.deletedAt)));
    }

    // 4. Soft-delete all projects
    if (projectIds.length > 0) {
      await tx
        .update(projects)
        .set({ deletedAt: now })
        .where(eq(projects.orgId, orgId));
    }

    // 5. Remove all org members
    await tx.delete(orgMembers).where(eq(orgMembers.orgId, orgId));

    // 6. Revoke all member sessions
    if (memberIds.length > 0) {
      await tx.delete(sessions).where(inArray(sessions.userId, memberIds));
    }

    // 7. Soft-delete the organization
    const [result] = await tx
      .update(organizations)
      .set({ deletedAt: now, deletedBy, updatedAt: now })
      .where(eq(organizations.id, orgId))
      .returning({ id: organizations.id, name: organizations.name });

    return result;
  });

  return { message: "Organization deleted successfully", org: updated };
};

export const getOrganizationById = async (orgId: string) => {
  const [org] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)));

  if (!org) throw new AppError("Organization not found", 404);

  // Fetch all members with their user info
  const members = await db
    .select({
      memberId: orgMembers.id,
      role: orgMembers.role,
      joinedAt: orgMembers.joinedAt,
      userId: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
      status: users.status,
    })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(and(eq(orgMembers.orgId, orgId), isNull(users.deletedAt)));

  return { ...org, members };
};

// ─── Assign Admin to Organization ────────────────────────────────────────────

export const assignAdminToOrg = async (orgId: string, userId: string) => {
  // Verify org exists and is not deleted
  const [org] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)));

  if (!org) throw new AppError("Organization not found", 404);

  // Verify user exists and has admin role
  const [user] = await db
    .select({ id: users.id, role: users.role, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId));

  if (!user || user.deletedAt) throw new AppError("User not found", 404);
  if (user.role !== "admin") throw new AppError("User must have the 'admin' role to be assigned as org admin", 400);

  // Check if this admin is already in another org
  const [existingMembership] = await db
    .select({ orgId: orgMembers.orgId })
    .from(orgMembers)
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.role, "admin")));

  if (existingMembership) {
    throw new AppError("This admin is already assigned to an organization. An admin can only belong to one organization.", 409);
  }

  return await db.transaction(async (tx) => {
    // Set owner_id on organization
    await tx
      .update(organizations)
      .set({ ownerId: userId, updatedAt: new Date() })
      .where(eq(organizations.id, orgId));

    // Add to org_members
    const [member] = await tx
      .insert(orgMembers)
      .values({ orgId, userId, role: "admin" })
      .returning();

    return { org: { ...org, ownerId: userId }, member };
  });
};

// ─── Add Developer to Organization (ADMIN) ───────────────────────────────────

export const addDeveloperToOrg = async (
  orgId: string,
  userId: string,
  addedByOrgId: string // The org the admin belongs to
) => {
  // Ensure admin is adding to their own org only
  if (orgId !== addedByOrgId) {
    throw new AppError("You can only add developers to your own organization", 403);
  }

  // Verify user exists and is a developer
  const [user] = await db
    .select({ id: users.id, role: users.role, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId));

  if (!user || user.deletedAt) throw new AppError("User not found", 404);
  if (user.role !== "developer") throw new AppError("User must have the 'developer' role", 400);

  // Check if developer is already in another org
  const [existingMembership] = await db
    .select({ orgId: orgMembers.orgId })
    .from(orgMembers)
    .where(eq(orgMembers.userId, userId));

  if (existingMembership) {
    throw new AppError("This developer is already a member of an organization", 409);
  }

  const [member] = await db
    .insert(orgMembers)
    .values({ orgId, userId, role: "developer" })
    .returning();

  return member;
};

// ─── Remove Member from Organization (with cascade) ──────────────────────────

export const removeMemberFromOrg = async (orgId: string, userId: string) => {
  const [member] = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));

  if (!member) throw new AppError("Member not found in this organization", 404);

  await db.transaction(async (tx) => {
    // Step 1: Get all project IDs in this org
    const orgProjects = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.orgId, orgId));

    const projectIds = orgProjects.map((p) => p.id);

    if (projectIds.length > 0) {
      // Step 2: Get all task IDs in those projects
      const orgTasks = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(inArray(tasks.projectId, projectIds));

      const taskIds = orgTasks.map((t) => t.id);

      // Step 3: Remove from task_assignees
      if (taskIds.length > 0) {
        await tx
          .delete(taskAssignees)
          .where(and(eq(taskAssignees.userId, userId), inArray(taskAssignees.taskId, taskIds)));
      }

      // Step 4: Remove from project_members
      await tx
        .delete(projectMembers)
        .where(and(eq(projectMembers.userId, userId), inArray(projectMembers.projectId, projectIds)));
    }

    // Step 5: If removing an admin, clear org owner_id
    if (member.role === "admin") {
      await tx
        .update(organizations)
        .set({ ownerId: null, updatedAt: new Date() })
        .where(eq(organizations.id, orgId));
    }

    // Step 6: Remove from org_members
    await tx
      .delete(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));

    // Step 7: Revoke all active sessions to immediately invalidate their JWT
    await tx.delete(sessions).where(eq(sessions.userId, userId));
  });

  return { message: "Member removed from organization successfully" };
};
