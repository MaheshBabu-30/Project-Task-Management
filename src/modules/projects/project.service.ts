import { db } from "../../config/db.js";
import { projects, tasks, projectMembers, users, taskAssignees } from "../../../drizzle/schema.js";
import { eq, ilike, and, asc, desc, isNull, inArray, notInArray } from "drizzle-orm";
import { AppError } from "../../utils/errors.js";

interface ProjectQuery {
  id?: string;
  title?: string;
  createdBy?: string;
  status?: "active" | "on_hold" | "completed";
  page?: number;
  limit?: number;
  sortBy?: string;
  order?: string;
  showDeleted?: boolean;
}

// ─── Create Project ──────────────────────────────────────────────────────────

export const createProject = async (data: {
  orgId: string;
  title: string;
  description?: string;
  logoUrl?: string;
  createdBy: string;
  assignedUserIds?: string[];
}) => {
  const { assignedUserIds, ...projectData } = data;

  return await db.transaction(async (tx) => {
    // 1. Insert Project
    const [newProject] = await tx
      .insert(projects)
      .values(projectData)
      .returning();

    if (!newProject) throw new AppError("Failed to create project", 500);

    // 2. Assign initial members if provided
    if (assignedUserIds && assignedUserIds.length > 0) {
      const memberEntries = assignedUserIds.map((userId) => ({
        projectId: newProject.id,
        userId: userId,
      }));
      await tx.insert(projectMembers).values(memberEntries);
    }

    return newProject;
  });
};

// ─── Get Projects (Scoped) ───────────────────────────────────────────────────

export const getProjects = async (
  query: ProjectQuery,
  user: { userId: string; role: string; orgId?: string }
) => {
  const { id, title, createdBy, status, page = 1, limit = 10, sortBy = "id", order = "asc", showDeleted = false } = query;

  const filters = [showDeleted ? notInArray(projects.deletedAt, [null as any]) : isNull(projects.deletedAt)];

  // 1. Scoping Logic
  if (user.role === "superadmin") {
    // Superadmin can filter by orgId if provided in query
    if (query.id) filters.push(eq(projects.orgId, query.id)); 
  } else {
    // Admins and developers are locked to their org
    if (!user.orgId) throw new AppError("User not assigned to an organization", 403);
    filters.push(eq(projects.orgId, user.orgId));

    if (user.role === "developer") {
      // Developers only see projects they are members of
      const subquery = db
        .select({ projectId: projectMembers.projectId })
        .from(projectMembers)
        .where(eq(projectMembers.userId, user.userId));
      
      filters.push(inArray(projects.id, subquery));
    }
  }

  // 2. Additional Filters
  if (id) filters.push(eq(projects.id, id));
  if (title) filters.push(ilike(projects.title, `%${title}%`));
  if (createdBy) filters.push(eq(projects.createdBy, createdBy));
  if (status) filters.push(eq(projects.status, status));

  const whereCondition = and(...filters);
  const offset = (page - 1) * limit;

  // 3. Sorting logic
  const validColumns: Record<string, any> = { id: projects.id, title: projects.title, createdAt: projects.createdAt };
  const orderColumn = validColumns[sortBy] || projects.id;
  const orderDirection = order === "desc" ? desc(orderColumn) : asc(orderColumn);

  const data = await db
    .select()
    .from(projects)
    .where(whereCondition)
    .orderBy(orderDirection)
    .limit(limit)
    .offset(offset);

  // 4. Batch fetch members (Fix N+1)
  const projectIds = data.map((p) => p.id);
  let membersMap: Record<string, any[]> = {};

  if (projectIds.length > 0) {
    const allMembers = await db
      .select({
        projectId: projectMembers.projectId,
        id: users.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
      })
      .from(projectMembers)
      .innerJoin(users, eq(projectMembers.userId, users.id))
      .where(inArray(projectMembers.projectId, projectIds));

    allMembers.forEach((m) => {
      const pId = m.projectId;
      if (!pId) return;
      if (!membersMap[pId]) membersMap[pId] = [];
      membersMap[pId]!.push({
        id: m.id,
        name: m.name,
        email: m.email,
        avatarUrl: m.avatarUrl,
      });
    });
  }

  const dataWithMembers = data.map((p) => ({
    ...p,
    members: membersMap[p.id] || [],
  }));

  const totalResult = await db
    .select({ count: projects.id })
    .from(projects)
    .where(whereCondition);

  return { data: dataWithMembers, totalRecords: totalResult.length };
};

// ─── Get Project By ID ───────────────────────────────────────────────────────

export const getProjectById = async (id: string, user: { userId: string; role: string; orgId?: string }) => {
  const filters = [eq(projects.id, id), isNull(projects.deletedAt)];

  // 1. Org Check for non-superadmins
  if (user.role !== "superadmin") {
    if (!user.orgId) throw new AppError("User not assigned to an organization", 403);
    filters.push(eq(projects.orgId, user.orgId));
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(and(...filters))
    .limit(1);

  if (!project) throw new AppError("Project not found", 404);

  // 2. Developer Check
  if (user.role === "developer") {
    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, user.userId)))
      .limit(1);
    
    if (!membership) throw new AppError("Access denied. You are not a member of this project.", 403);
  }

  // 3. Fetch members
  const members = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(projectMembers)
    .innerJoin(users, eq(projectMembers.userId, users.id))
    .where(eq(projectMembers.projectId, id));

  return { ...project, members };
};

// ─── Update Project ──────────────────────────────────────────────────────────

export const updateProject = async (id: string, data: any, orgId: string) => {
  const { assignedUserIds, ...projectData } = data;

  return await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(projects)
      .set({ ...projectData, updatedAt: new Date() })
      .where(and(eq(projects.id, id), eq(projects.orgId, orgId)))
      .returning();

    if (!updated) throw new AppError("Project not found or access denied", 404);

    // If assignedUserIds is provided, sync the membership
    if (assignedUserIds) {
      // Simplification: clear and re-add. In prod, you'd do a diff.
      await tx.delete(projectMembers).where(eq(projectMembers.projectId, id));
      const memberEntries = assignedUserIds.map((userId: string) => ({
        projectId: id,
        userId: userId,
      }));
      if (memberEntries.length > 0) {
        await tx.insert(projectMembers).values(memberEntries);
      }
    }

    return updated;
  });
};

// ─── Delete Project ──────────────────────────────────────────────────────────

export const deleteProject = async (id: string, orgId: string) => {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.orgId, orgId), isNull(projects.deletedAt)));

  if (!project) throw new AppError("Project not found", 404);

  // Guard check: All tasks must be completed
  const pendingTasks = await db
    .select()
    .from(tasks)
    .where(and(
      eq(tasks.projectId, id),
      isNull(tasks.deletedAt),
      notInArray(tasks.status, ["completed"])
    ));

  if (pendingTasks.length > 0) {
    throw new AppError(`Cannot delete project. There are still ${pendingTasks.length} pending tasks.`, 400);
  }

  await db.transaction(async (tx) => {
    // Soft delete project
    await tx.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, id));
    // Soft delete tasks
    await tx.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.projectId, id));
  });

  return { message: "Project and associated tasks soft-deleted successfully" };
};
