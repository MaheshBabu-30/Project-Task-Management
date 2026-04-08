import bcrypt from "bcrypt";
import { db } from "../../config/db.js";
import { organizations, orgMembers, users } from "../../../drizzle/schema.js";
import { eq, and, isNull } from "drizzle-orm";
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

export const getAllOrganizations = async () => {
  const orgs = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      ownerId: organizations.ownerId,
      createdAt: organizations.createdAt,
    })
    .from(organizations);

  return orgs;
};

// ─── Get Organization By ID ───────────────────────────────────────────────────

export const getOrganizationById = async (orgId: string) => {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId));

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
  // Verify org exists
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId));

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

// ─── Register New Admin and Assign to Org (SUPERADMIN) ───────────────────────

export const registerAdminForOrg = async (orgId: string, userData: { name: string; email: string; password: string }) => {
  // 1. Verify org exists
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId));

  if (!org) throw new AppError("Organization not found", 404);

  // 2. Check email uniqueness
  const [existingUser] = await db.select().from(users).where(eq(users.email, userData.email));
  if (existingUser) throw new AppError("Email already registered", 409);

  return await db.transaction(async (tx) => {
    // 3. Create the user with 'admin' role
    const passwordHash = await bcrypt.hash(userData.password, 10);
    const [newUser] = await tx
      .insert(users)
      .values({
        name: userData.name,
        email: userData.email,
        passwordHash,
        role: "admin",
      })
      .returning({ id: users.id, name: users.name, email: users.email });

    if (!newUser) throw new AppError("Failed to create user", 500);

    // 4. Set owner_id on organization
    await tx
      .update(organizations)
      .set({ ownerId: newUser.id, updatedAt: new Date() })
      .where(eq(organizations.id, orgId));

    // 5. Add to org_members
    const [member] = await tx
      .insert(orgMembers)
      .values({ orgId, userId: newUser.id, role: "admin" })
      .returning();

    return { user: newUser, org, member };
  });
};

// ─── Register New Developer and Assign to Org (ADMIN only) ───────────────────

export const registerDeveloperForOrg = async (
  orgId: string,
  addedByOrgId: string,
  userData: { name: string; email: string; password: string }
) => {
  // 1. Ensure admin is adding to their own org only
  if (orgId !== addedByOrgId) {
    throw new AppError("You can only add developers to your own organization", 403);
  }

  // 2. Check email uniqueness
  const [existingUser] = await db.select().from(users).where(eq(users.email, userData.email));
  if (existingUser) throw new AppError("Email already registered", 409);

  return await db.transaction(async (tx) => {
    // 3. Create the user with 'developer' role
    const passwordHash = await bcrypt.hash(userData.password, 10);
    const [newUser] = await tx
      .insert(users)
      .values({
        name: userData.name,
        email: userData.email,
        passwordHash,
        role: "developer",
      })
      .returning({ id: users.id, name: users.name, email: users.email });

    if (!newUser) throw new AppError("Failed to create user", 500);

    // 4. Add to org_members
    const [member] = await tx
      .insert(orgMembers)
      .values({ orgId, userId: newUser.id, role: "developer" })
      .returning();

    return { user: newUser, member };
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

// ─── Remove Member from Organization ─────────────────────────────────────────

export const removeMemberFromOrg = async (orgId: string, userId: string) => {
  const [member] = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));

  if (!member) throw new AppError("Member not found in this organization", 404);

  // If removing an admin, also clear the owner_id from the org
  if (member.role === "admin") {
    await db
      .update(organizations)
      .set({ ownerId: null, updatedAt: new Date() })
      .where(eq(organizations.id, orgId));
  }

  await db
    .delete(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));

  return { message: "Member removed from organization successfully" };
};
