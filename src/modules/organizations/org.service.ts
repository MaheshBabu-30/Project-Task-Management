import { db } from "../../config/db.js";
import { organizations, orgMembers, users, projects, projectMembers, taskAssignees, tasks, sessions, comments } from "../../db/schema/index.js";
import { eq, and, isNull, inArray, ilike, asc, desc, count } from "drizzle-orm";
import { BadRequestException, ForbiddenException, NotFoundException, ConflictException, InternalServerException } from "../../exceptions/index.js";
import { ORG_NOT_FOUND, ADMIN_ROLE_REQUIRED, ADMIN_ALREADY_IN_ORG, ORG_ALREADY_HAS_ADMIN, SLUG_TAKEN, USER_NOT_FOUND } from "../../constants/appMessages.js";
import type { UserSummary, PaginationQuery } from "../../types/common.types.js";

interface OrgQuery extends PaginationQuery {
  name?: string;
  slug?: string;
}

// ─── Create Organization ──────────────────────────────────────────────────────

export const createOrganization = async (data: { name: string; slug: string; description?: string }) => {
  const [existing] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, data.slug));

  if (existing) throw new ConflictException(SLUG_TAKEN(data.slug));

  const [org] = await db
    .insert(organizations)
    .values({ name: data.name, slug: data.slug, description: data.description ?? null })
    .returning();

  return org;
};

// ─── Get All Organizations (SUPERADMIN) ───────────────────────────────────────

export const getAllOrganizations = async (query?: OrgQuery) => {
  const { name, slug, page = 1, limit = 20, sortBy = "createdAt", order = "asc" } = query ?? {};
  const offset = (page - 1) * limit;

  const conditions = [isNull(organizations.deletedAt)];
  if (name) conditions.push(ilike(organizations.name, `%${name}%`));
  if (slug) conditions.push(ilike(organizations.slug, `%${slug}%`));

  const whereCondition = and(...conditions);

  const validColumns = {
    id: organizations.id, name: organizations.name,
    slug: organizations.slug, createdAt: organizations.createdAt,
  } as const;
  const orderColumn = (sortBy in validColumns ? validColumns[sortBy as keyof typeof validColumns] : organizations.createdAt);
  const orderDirection = order === "desc" ? desc(orderColumn) : asc(orderColumn);

  const [orgs, countResult] = await Promise.all([
    db.select({ id: organizations.id, name: organizations.name, slug: organizations.slug, ownerId: organizations.ownerId, createdAt: organizations.createdAt })
      .from(organizations).where(whereCondition).orderBy(orderDirection).limit(limit).offset(offset),
    db.select({ total: count() }).from(organizations).where(whereCondition),
  ]);

  const ownerIds = orgs.map((o) => o.ownerId).filter(Boolean) as string[];
  const ownersMap: Record<string, UserSummary> = {};
  if (ownerIds.length > 0) {
    const owners = await db
      .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
      .from(users).where(inArray(users.id, ownerIds));
    owners.forEach((o) => { ownersMap[o.id] = o; });
  }

  const data = orgs.map((org) => ({ ...org, owner: org.ownerId ? (ownersMap[org.ownerId] ?? null) : null }));
  return { data, totalRecords: countResult[0]?.total ?? 0 };
};

// ─── Soft Delete Organization ─────────────────────────────────────────────────

export const getOrgSnapshot = async (id: string) => {
  const [row] = await db
    .select({ name: organizations.name, slug: organizations.slug })
    .from(organizations)
    .where(and(eq(organizations.id, id), isNull(organizations.deletedAt)))
    .limit(1);
  return row ?? null;
};

export const softDeleteOrg = async (orgId: string, deletedBy: string) => {
  const [org] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)));

  if (!org) throw new NotFoundException(ORG_NOT_FOUND);

  const now = new Date();

  const updated = await db.transaction(async (tx) => {
    const members = await tx.select({ userId: orgMembers.userId }).from(orgMembers).where(eq(orgMembers.orgId, orgId));
    const memberIds = members.map((m) => m.userId);

    const orgProjects = await tx.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.orgId, orgId), isNull(projects.deletedAt)));
    const projectIds = orgProjects.map((p) => p.id);

    if (projectIds.length > 0) {
      const orgTaskIds = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(inArray(tasks.projectId, projectIds), isNull(tasks.deletedAt)));

      if (orgTaskIds.length > 0) {
        await tx
          .update(comments)
          .set({ deletedAt: now })
          .where(and(inArray(comments.taskId, orgTaskIds.map((t) => t.id)), isNull(comments.deletedAt)));
      }

      await tx.update(tasks).set({ deletedAt: now }).where(and(inArray(tasks.projectId, projectIds), isNull(tasks.deletedAt)));
      await tx.update(projects).set({ deletedAt: now }).where(eq(projects.orgId, orgId));
    }

    await tx.delete(orgMembers).where(eq(orgMembers.orgId, orgId));
    if (memberIds.length > 0) await tx.delete(sessions).where(inArray(sessions.userId, memberIds));

    const [result] = await tx
      .update(organizations)
      .set({ deletedAt: now, deletedBy, updatedAt: now })
      .where(eq(organizations.id, orgId))
      .returning({ id: organizations.id, name: organizations.name });

    return result;
  });

  return { message: "Organization deleted successfully", org: updated };
};

// ─── Get Organization By ID ───────────────────────────────────────────────────

export const getOrganizationById = async (orgId: string) => {
  const [org] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)));

  if (!org) throw new NotFoundException(ORG_NOT_FOUND);

  const members = await db
    .select({
      memberId: orgMembers.id, role: orgMembers.role, joinedAt: orgMembers.joinedAt,
      userId: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl, status: users.status,
    })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(and(eq(orgMembers.orgId, orgId), isNull(users.deletedAt)));

  return { ...org, members };
};

// ─── Assign Admin to Organization ────────────────────────────────────────────

export const assignAdminToOrg = async (orgId: string, userId: string) => {
  const [org] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)));

  if (!org) throw new NotFoundException(ORG_NOT_FOUND);

  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, phone: users.phone, avatarUrl: users.avatarUrl, role: users.role, status: users.status, deletedAt: users.deletedAt })
    .from(users).where(eq(users.id, userId));

  if (!user || user.deletedAt) throw new NotFoundException(USER_NOT_FOUND);
  if (user.role !== "admin") throw new BadRequestException(ADMIN_ROLE_REQUIRED);

  const [existingMembership] = await db
    .select({ orgId: orgMembers.orgId })
    .from(orgMembers)
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.role, "admin")));

  if (existingMembership) throw new ConflictException(ADMIN_ALREADY_IN_ORG);

  const [orgExistingAdmin] = await db
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, "admin")));

  if (orgExistingAdmin) throw new ConflictException(ORG_ALREADY_HAS_ADMIN);

  return await db.transaction(async (tx) => {
    await tx.update(organizations).set({ ownerId: userId, updatedAt: new Date() }).where(eq(organizations.id, orgId));
    const [member] = await tx.insert(orgMembers).values({ orgId, userId, role: "admin" }).returning();
    if (!member) throw new InternalServerException("Failed to assign admin to organization");
    return {
      org: { ...org, ownerId: userId },
      member: { ...member, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, avatarUrl: user.avatarUrl, status: user.status } },
    };
  });
};

// ─── Add Developer to Organization ───────────────────────────────────────────

export const addDeveloperToOrg = async (orgId: string, userId: string, addedByOrgId: string) => {
  if (orgId !== addedByOrgId) throw new ForbiddenException("You can only add developers to your own organization");

  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, phone: users.phone, avatarUrl: users.avatarUrl, role: users.role, status: users.status, deletedAt: users.deletedAt })
    .from(users).where(eq(users.id, userId));

  if (!user || user.deletedAt) throw new NotFoundException(USER_NOT_FOUND);
  if (user.role !== "developer") throw new BadRequestException("User must have the 'developer' role");

  const [existingMembership] = await db
    .select({ orgId: orgMembers.orgId })
    .from(orgMembers).where(eq(orgMembers.userId, userId));

  if (existingMembership) throw new ConflictException("This developer is already a member of an organization");

  const [member] = await db.insert(orgMembers).values({ orgId, userId, role: "developer" }).returning();
  if (!member) throw new InternalServerException("Failed to add developer to organization");
  return { ...member, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, avatarUrl: user.avatarUrl, status: user.status } };
};

// ─── Remove Member from Organization ─────────────────────────────────────────

export const removeMemberFromOrg = async (orgId: string, userId: string) => {
  const [member] = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));

  if (!member) throw new NotFoundException("Member not found in this organization");

  await db.transaction(async (tx) => {
    const orgProjects = await tx.select({ id: projects.id }).from(projects).where(eq(projects.orgId, orgId));
    const projectIds = orgProjects.map((p) => p.id);

    if (projectIds.length > 0) {
      const orgTasks = await tx.select({ id: tasks.id }).from(tasks).where(inArray(tasks.projectId, projectIds));
      const taskIds = orgTasks.map((t) => t.id);
      if (taskIds.length > 0) {
        await tx.delete(taskAssignees).where(and(eq(taskAssignees.userId, userId), inArray(taskAssignees.taskId, taskIds)));
      }
      await tx.delete(projectMembers).where(and(eq(projectMembers.userId, userId), inArray(projectMembers.projectId, projectIds)));
    }

    if (member.role === "admin") {
      await tx.update(organizations).set({ ownerId: null, updatedAt: new Date() }).where(eq(organizations.id, orgId));
    }

    await tx.delete(orgMembers).where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
  });

  return { message: "Member removed from organization successfully" };
};
