import { db } from "../../config/db.js";
import { projects, tasks, projectMembers, orgMembers, organizations, users, taskAssignees } from "../../db/schema.js";
import { eq, ilike, and, asc, desc, isNull, isNotNull, inArray, notInArray, count, sql } from "drizzle-orm";
import { BadRequestException, UnauthorizedException, ForbiddenException, NotFoundException, ConflictException, InternalServerException } from "../../exceptions/index.js";
import * as M from "../../constants/appMessages.js";
import type { UserSummary } from "../../types/common.types.js";

interface UpdateProjectData {
  title?: string;
  description?: string;
  logoUrl?: string;
  status?: "active" | "on_hold" | "completed";
  assignedUserIds?: string[];
}

interface ProjectQuery {
  id?: string;
  orgId?: string;
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

  const newProject = await db.transaction(async (tx) => {
    // 0. Verify org exists and is not deleted
    const [org] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, data.orgId), isNull(organizations.deletedAt)));

    if (!org) throw new NotFoundException(M.ORG_NOT_FOUND);

    // 1. Insert Project
    const [project] = await tx
      .insert(projects)
      .values(projectData)
      .returning();

    if (!project) throw new InternalServerException(M.PROJECT_CREATE_FAILED);

    // 2. Assign initial members if provided
    if (assignedUserIds && assignedUserIds.length > 0) {
      const validMembers = await tx
        .select({ userId: orgMembers.userId })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, data.orgId), inArray(orgMembers.userId, assignedUserIds)));

      if (validMembers.length !== assignedUserIds.length) {
        throw new BadRequestException(M.INVALID_PROJECT_MEMBERS);
      }

      const memberEntries = assignedUserIds.map((userId) => ({
        projectId: project.id,
        userId,
      }));
      await tx.insert(projectMembers).values(memberEntries);
    }

    return project;
  });

  // Fetch members with user info to return consistent shape
  const members = await db
    .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
    .from(projectMembers)
    .innerJoin(users, eq(projectMembers.userId, users.id))
    .where(eq(projectMembers.projectId, newProject.id));

  const [creator] = newProject.createdBy
    ? await db
        .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
        .from(users)
        .where(eq(users.id, newProject.createdBy))
    : [null];

  return { ...newProject, members, creator: creator ?? null };
};

// ─── Get Projects (Scoped) ───────────────────────────────────────────────────

export const getProjects = async (
  query: ProjectQuery,
  user: { userId: string; role: string; orgId?: string }
) => {
  const { id, orgId, title, createdBy, status, page = 1, limit = 10, sortBy = "id", order = "asc", showDeleted = false } = query;

  const filters = [showDeleted ? isNotNull(projects.deletedAt) : isNull(projects.deletedAt)];

  // 1. Scoping Logic
  if (user.role === "superadmin") {
    // Superadmin can filter by orgId if provided in query
    if (orgId) filters.push(eq(projects.orgId, orgId));
  } else {
    // Admins and developers are locked to their org
    if (!user.orgId) throw new ForbiddenException(M.USER_NO_ORG);
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
  const validColumns = {
    id: projects.id,
    title: projects.title,
    status: projects.status,
    createdAt: projects.createdAt,
  } as const;
  const orderColumn = (sortBy in validColumns ? validColumns[sortBy as keyof typeof validColumns] : projects.id);
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
  let membersMap: Record<string, UserSummary[]> = {};

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

  // Batch fetch creators
  const creatorIds = [...new Set(data.map((p) => p.createdBy).filter(Boolean))] as string[];
  const creatorsMap: Record<string, UserSummary> = {};
  if (creatorIds.length > 0) {
    const allCreators = await db
      .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
      .from(users)
      .where(inArray(users.id, creatorIds));
    allCreators.forEach((c) => { creatorsMap[c.id] = c; });
  }

  const dataWithMembers = data.map((p) => ({
    ...p,
    members: membersMap[p.id] || [],
    creator: p.createdBy ? (creatorsMap[p.createdBy] ?? null) : null,
  }));

  const countResult = await db
    .select({ total: count() })
    .from(projects)
    .where(whereCondition);

  return { data: dataWithMembers, totalRecords: countResult[0]?.total ?? 0 };
};

// ─── Get Project By ID ───────────────────────────────────────────────────────

export const getProjectById = async (id: string, user: { userId: string; role: string; orgId?: string }) => {
  const filters = [eq(projects.id, id), isNull(projects.deletedAt)];

  // 1. Org Check for non-superadmins
  if (user.role !== "superadmin") {
    if (!user.orgId) throw new ForbiddenException(M.USER_NO_ORG);
    filters.push(eq(projects.orgId, user.orgId));
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(and(...filters))
    .limit(1);

  if (!project) throw new NotFoundException(M.PROJECT_NOT_FOUND);

  // 2. Developer Check
  if (user.role === "developer") {
    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, user.userId)))
      .limit(1);
    
    if (!membership) throw new ForbiddenException(M.PROJECT_NOT_MEMBER);
  }

  // 3. Fetch members, creator, task stats, and per-member task counts in parallel
  const [members, creatorResult, taskStatsResult, memberTaskCounts] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
      })
      .from(projectMembers)
      .innerJoin(users, eq(projectMembers.userId, users.id))
      .where(eq(projectMembers.projectId, id)),

    project.createdBy
      ? db
          .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
          .from(users)
          .where(eq(users.id, project.createdBy))
      : Promise.resolve([] as { id: string; name: string; email: string; avatarUrl: string | null }[]),

    db
      .select({
        total: count(),
        pending: sql<number>`COUNT(CASE WHEN ${tasks.status} = 'to_do' AND NOT (${tasks.dueDate} IS NOT NULL AND ${tasks.dueDate} < CURRENT_DATE) THEN 1 END)`.mapWith(Number),
        inProgress: sql<number>`COUNT(CASE WHEN ${tasks.status} = 'in_progress' AND NOT (${tasks.dueDate} IS NOT NULL AND ${tasks.dueDate} < CURRENT_DATE) THEN 1 END)`.mapWith(Number),
        onHold: sql<number>`COUNT(CASE WHEN ${tasks.status} = 'on_hold' THEN 1 END)`.mapWith(Number),
        overdue: sql<number>`COUNT(CASE WHEN ${tasks.status} = 'overdue' OR (${tasks.dueDate} IS NOT NULL AND ${tasks.dueDate} < CURRENT_DATE AND ${tasks.status} NOT IN ('completed', 'on_hold', 'overdue')) THEN 1 END)`.mapWith(Number),
        completed: sql<number>`COUNT(CASE WHEN ${tasks.status} = 'completed' THEN 1 END)`.mapWith(Number),
      })
      .from(tasks)
      .where(and(eq(tasks.projectId, id), isNull(tasks.deletedAt))),

    db
      .select({
        userId: taskAssignees.userId,
        totalAssigned: count(),
      })
      .from(taskAssignees)
      .innerJoin(tasks, eq(taskAssignees.taskId, tasks.id))
      .where(and(eq(tasks.projectId, id), isNull(tasks.deletedAt)))
      .groupBy(taskAssignees.userId),
  ]);

  const creator = creatorResult[0] ?? null;

  const memberTaskCountMap = new Map(memberTaskCounts.map((m) => [m.userId, m.totalAssigned]));
  const membersWithTaskCounts = members.map((member) => ({
    ...member,
    totalTasksAssigned: memberTaskCountMap.get(member.id) ?? 0,
  }));

  const stats = taskStatsResult[0] ?? { total: 0, pending: 0, inProgress: 0, onHold: 0, overdue: 0, completed: 0 };

  return {
    ...project,
    members: membersWithTaskCounts,
    creator,
    taskStats: {
      total: stats.total,
      pending: stats.pending,
      inProgress: stats.inProgress,
      onHold: stats.onHold,
      overdue: stats.overdue,
      completed: stats.completed,
    },
  };
};

// ─── Update Project ──────────────────────────────────────────────────────────

export const updateProject = async (id: string, data: UpdateProjectData, orgId?: string) => {
  const { assignedUserIds, ...projectData } = data;

  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(projects)
      .set({ ...projectData, updatedAt: new Date() })
      .where(orgId
        ? and(eq(projects.id, id), eq(projects.orgId, orgId), isNull(projects.deletedAt))
        : and(eq(projects.id, id), isNull(projects.deletedAt)))
      .returning();

    if (!updated) throw new NotFoundException(M.PROJECT_NOT_FOUND_OR_DENIED);

    // If assignedUserIds is provided, sync the membership
    if (assignedUserIds !== undefined) {
      if (assignedUserIds.length === 0) {
        throw new BadRequestException(M.PROJECT_MEMBERS_EMPTY);
      }
      await tx.delete(projectMembers).where(eq(projectMembers.projectId, id));

      if (assignedUserIds.length > 0) {
        const validMembers = await tx
          .select({ userId: orgMembers.userId })
          .from(orgMembers)
          .where(and(eq(orgMembers.orgId, updated.orgId), inArray(orgMembers.userId, assignedUserIds)));

        if (validMembers.length !== assignedUserIds.length) {
          throw new BadRequestException(M.INVALID_PROJECT_MEMBERS);
        }

        await tx.insert(projectMembers).values(
          assignedUserIds.map((userId: string) => ({ projectId: id, userId }))
        );
      }
    }

    return updated;
  });

  // Fetch members with user info to return consistent shape
  const members = await db
    .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
    .from(projectMembers)
    .innerJoin(users, eq(projectMembers.userId, users.id))
    .where(eq(projectMembers.projectId, id));

  const [creator] = result.createdBy
    ? await db
        .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
        .from(users)
        .where(eq(users.id, result.createdBy))
    : [null];

  return { ...result, members, creator: creator ?? null };
};

// ─── Delete Project ──────────────────────────────────────────────────────────

export const deleteProject = async (id: string, orgId?: string) => {
  const [project] = await db
    .select()
    .from(projects)
    .where(orgId
      ? and(eq(projects.id, id), eq(projects.orgId, orgId), isNull(projects.deletedAt))
      : and(eq(projects.id, id), isNull(projects.deletedAt)));

  if (!project) throw new NotFoundException(M.PROJECT_NOT_FOUND);

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
    throw new BadRequestException(M.PROJECT_PENDING_TASKS(pendingTasks.length));
  }

  await db.transaction(async (tx) => {
    // Soft delete project
    await tx.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, id));
    // Soft delete tasks
    await tx.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.projectId, id));
  });

  return { message: "Project and associated tasks deleted successfully", orgId: project.orgId };
};
