import bcrypt from "bcrypt";
import { randomBytes } from "crypto";
import { db } from "../../config/db.js";
import { tasks, projects, taskAssignees, projectMembers, orgMembers, users, organizations } from "../../db/schema/index.js";
import { eq, and, isNull, inArray, count, sql } from "drizzle-orm";
import { BadRequestException, ForbiddenException, NotFoundException, ConflictException, InternalServerException } from "../../exceptions/index.js";
import * as M from "../../constants/appMessages.js";
import { sendWelcomeEmail } from "../../utils/mail.service.js";
import { logger } from "../../utils/logger.js";
import type { TaskStatus, TaskPriority } from "../../types/task.types.js";
import type { ImportTasksBody, ImportProjectBody, ImportOrgBody, ImportUsersBody } from "./data-transfer.schema.js";

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
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      description: organizations.description,
    })
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

// type=organizations — superadmin only (enforced here)
export const exportAllOrganizations = async (user: User) => {
  if (user.role !== "superadmin") throw new ForbiddenException(M.ACCESS_DENIED);

  const orgList = await db
    .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, description: organizations.description })
    .from(organizations)
    .where(isNull(organizations.deletedAt));

  return {
    exportedAt: new Date().toISOString(),
    type: "organizations" as const,
    totalOrganizations: orgList.length,
    organizations: orgList.map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      description: o.description ?? null,
    })),
  };
};

// type=projects — list of projects in org, optionally filtered to one project
export const exportProjects = async (orgId: string, user: User, filters: { projectId?: string }) => {
  const org = await validateOrgAccess(orgId, user);

  const projectList = await db
    .select({ id: projects.id, title: projects.title, description: projects.description, status: projects.status })
    .from(projects)
    .where(
      and(
        eq(projects.orgId, orgId),
        isNull(projects.deletedAt),
        filters.projectId ? eq(projects.id, filters.projectId) : undefined,
      ),
    );

  if (filters.projectId && projectList.length === 0)
    throw new NotFoundException(M.PROJECT_NOT_FOUND);

  return {
    exportedAt: new Date().toISOString(),
    type: "projects" as const,
    orgId: org.id,
    orgName: org.name,
    filters: { projectId: filters.projectId ?? null },
    totalProjects: projectList.length,
    projects: projectList.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description ?? null,
      status: p.status,
    })),
  };
};

// type=tasks — tasks at org/project/task scope, with optional filters
export const exportTasks = async (
  orgId: string,
  user: User,
  filters: {
    projectId?: string;
    taskId?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    assigneeEmail?: string;
  },
) => {
  const org = await validateOrgAccess(orgId, user);
  const fmtDate = (d: Date | null) => (d ? d.toISOString().split("T")[0] : null);

  type SubRow = { title: string; description: string | null; status: string; priority: string; dueDate: string | null; assigneeEmails: string[] };
  type TaskRow = SubRow & { projectId: string; projectTitle: string | null; subtasks: SubRow[] };

  const activeFilters = {
    projectId: filters.projectId ?? null,
    taskId: filters.taskId ?? null,
    status: filters.status ?? null,
    priority: filters.priority ?? null,
    assigneeEmail: filters.assigneeEmail ?? null,
  };

  const empty = (): { exportedAt: string; type: "tasks"; orgId: string; orgName: string; filters: typeof activeFilters; totalTasks: number; tasks: TaskRow[] } => ({
    exportedAt: new Date().toISOString(),
    type: "tasks" as const,
    orgId: org.id,
    orgName: org.name,
    filters: activeFilters,
    totalTasks: 0,
    tasks: [],
  });

  const buildAssigneeMap = (rows: { taskId: string | null; email: string }[]) => {
    const map: Record<string, string[]> = {};
    rows.forEach((a) => {
      if (!a.taskId) return;
      if (!map[a.taskId]) map[a.taskId] = [];
      map[a.taskId]!.push(a.email);
    });
    return map;
  };

  // taskId scope: subtasks of a specific task
  if (filters.taskId) {
    const [parentTask] = await db
      .select({ id: tasks.id, projectId: tasks.projectId })
      .from(tasks)
      .innerJoin(projects, and(eq(tasks.projectId, projects.id), eq(projects.orgId, orgId)))
      .where(and(eq(tasks.id, filters.taskId), isNull(tasks.deletedAt)));

    if (!parentTask) throw new NotFoundException(M.TASK_NOT_FOUND);

    const [proj] = await db
      .select({ id: projects.id, title: projects.title })
      .from(projects)
      .where(eq(projects.id, parentTask.projectId));

    const projectMap: Record<string, string> = proj ? { [proj.id]: proj.title } : {};

    let subtasks = await db
      .select({ id: tasks.id, projectId: tasks.projectId, title: tasks.title, description: tasks.description, status: tasks.status, priority: tasks.priority, dueDate: tasks.dueDate })
      .from(tasks)
      .where(
        and(
          eq(tasks.parentTaskId, filters.taskId),
          isNull(tasks.deletedAt),
          filters.status ? eq(tasks.status, filters.status) : undefined,
          filters.priority ? eq(tasks.priority, filters.priority) : undefined,
        ),
      );

    if (subtasks.length === 0) return empty();

    if (filters.assigneeEmail) {
      const [member] = await db
        .select({ userId: orgMembers.userId })
        .from(orgMembers)
        .innerJoin(users, eq(orgMembers.userId, users.id))
        .where(and(eq(orgMembers.orgId, orgId), eq(users.email, filters.assigneeEmail), isNull(users.deletedAt)));

      if (!member) return empty();

      const assigned = await db
        .select({ taskId: taskAssignees.taskId })
        .from(taskAssignees)
        .where(and(eq(taskAssignees.userId, member.userId), inArray(taskAssignees.taskId, subtasks.map((s) => s.id))));

      const assignedSet = new Set(assigned.map((a) => a.taskId));
      subtasks = subtasks.filter((s) => assignedSet.has(s.id));
      if (subtasks.length === 0) return empty();
    }

    const assigneeMap = buildAssigneeMap(
      await db
        .select({ taskId: taskAssignees.taskId, email: users.email })
        .from(taskAssignees)
        .innerJoin(users, eq(taskAssignees.userId, users.id))
        .where(and(inArray(taskAssignees.taskId, subtasks.map((s) => s.id)), isNull(users.deletedAt))),
    );

    return {
      exportedAt: new Date().toISOString(),
      type: "tasks" as const,
      orgId: org.id,
      orgName: org.name,
      filters: { ...activeFilters, projectId: parentTask.projectId },
      totalTasks: subtasks.length,
      tasks: subtasks.map((s) => ({
        projectId: s.projectId,
        projectTitle: projectMap[s.projectId] ?? null,
        title: s.title,
        description: s.description ?? null,
        status: s.status,
        priority: s.priority,
        dueDate: fmtDate(s.dueDate),
        assigneeEmails: assigneeMap[s.id] ?? [],
        subtasks: [],
      })),
    };
  }

  // Project or org scope: root tasks with optional filters
  const projectList = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(
      and(
        eq(projects.orgId, orgId),
        isNull(projects.deletedAt),
        filters.projectId ? eq(projects.id, filters.projectId) : undefined,
      ),
    );

  if (filters.projectId && projectList.length === 0)
    throw new NotFoundException(M.PROJECT_NOT_FOUND);
  if (projectList.length === 0) return empty();

  const projectIds = projectList.map((p) => p.id);
  const projectMap: Record<string, string> = {};
  projectList.forEach((p) => { projectMap[p.id] = p.title; });

  // Resolve assigneeEmail filter to specific task IDs
  let assigneeTaskIds: string[] | null = null;
  if (filters.assigneeEmail) {
    const [member] = await db
      .select({ userId: orgMembers.userId })
      .from(orgMembers)
      .innerJoin(users, eq(orgMembers.userId, users.id))
      .where(and(eq(orgMembers.orgId, orgId), eq(users.email, filters.assigneeEmail), isNull(users.deletedAt)));

    if (!member) return empty();

    const assigned = await db
      .select({ taskId: taskAssignees.taskId })
      .from(taskAssignees)
      .where(eq(taskAssignees.userId, member.userId));

    assigneeTaskIds = assigned.map((a) => a.taskId).filter((id): id is string => !!id);
    if (assigneeTaskIds.length === 0) return empty();
  }

  const rootTasks = await db
    .select({ id: tasks.id, projectId: tasks.projectId, title: tasks.title, description: tasks.description, status: tasks.status, priority: tasks.priority, dueDate: tasks.dueDate })
    .from(tasks)
    .where(
      and(
        inArray(tasks.projectId, projectIds),
        isNull(tasks.parentTaskId),
        isNull(tasks.deletedAt),
        filters.status ? eq(tasks.status, filters.status) : undefined,
        filters.priority ? eq(tasks.priority, filters.priority) : undefined,
        assigneeTaskIds ? inArray(tasks.id, assigneeTaskIds) : undefined,
      ),
    );

  if (rootTasks.length === 0) return empty();

  const rootTaskIds = rootTasks.map((t) => t.id);

  const allSubtasks = await db
    .select({ id: tasks.id, parentTaskId: tasks.parentTaskId, title: tasks.title, description: tasks.description, status: tasks.status, priority: tasks.priority, dueDate: tasks.dueDate })
    .from(tasks)
    .where(and(inArray(tasks.parentTaskId, rootTaskIds), isNull(tasks.deletedAt)));

  const allTaskIds = [...rootTaskIds, ...allSubtasks.map((s) => s.id)];

  const assigneeMap = buildAssigneeMap(
    await db
      .select({ taskId: taskAssignees.taskId, email: users.email })
      .from(taskAssignees)
      .innerJoin(users, eq(taskAssignees.userId, users.id))
      .where(and(inArray(taskAssignees.taskId, allTaskIds), isNull(users.deletedAt))),
  );

  const subtaskMap: Record<string, typeof allSubtasks> = {};
  allSubtasks.forEach((s) => {
    if (!s.parentTaskId) return;
    if (!subtaskMap[s.parentTaskId]) subtaskMap[s.parentTaskId] = [];
    subtaskMap[s.parentTaskId]!.push(s);
  });

  return {
    exportedAt: new Date().toISOString(),
    type: "tasks" as const,
    orgId: org.id,
    orgName: org.name,
    filters: activeFilters,
    totalTasks: rootTasks.length,
    tasks: rootTasks.map((t) => ({
      projectId: t.projectId,
      projectTitle: projectMap[t.projectId] ?? null,
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
    })),
  };
};

// type=users — users at org/project/task scope
export const exportUsers = async (
  orgId: string,
  user: User,
  filters: { projectId?: string; taskId?: string },
) => {
  const org = await validateOrgAccess(orgId, user);

  // taskId scope: users assigned to a specific task
  if (filters.taskId) {
    const [task] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .innerJoin(projects, and(eq(tasks.projectId, projects.id), eq(projects.orgId, orgId)))
      .where(and(eq(tasks.id, filters.taskId), isNull(tasks.deletedAt)));

    if (!task) throw new NotFoundException(M.TASK_NOT_FOUND);

    const assignees = await db
      .select({ name: users.name, email: users.email, role: orgMembers.role })
      .from(taskAssignees)
      .innerJoin(users, eq(taskAssignees.userId, users.id))
      .innerJoin(orgMembers, and(eq(orgMembers.userId, taskAssignees.userId), eq(orgMembers.orgId, orgId)))
      .where(and(eq(taskAssignees.taskId, filters.taskId), isNull(users.deletedAt)));

    return {
      exportedAt: new Date().toISOString(),
      type: "users" as const,
      orgId: org.id,
      orgName: org.name,
      filters: { projectId: null, taskId: filters.taskId },
      totalUsers: assignees.length,
      users: assignees.map((u) => ({ name: u.name, email: u.email, role: u.role })),
    };
  }

  // projectId scope: members of a specific project
  if (filters.projectId) {
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, filters.projectId), eq(projects.orgId, orgId), isNull(projects.deletedAt)));

    if (!project) throw new NotFoundException(M.PROJECT_NOT_FOUND);

    const members = await db
      .select({ name: users.name, email: users.email, role: orgMembers.role })
      .from(projectMembers)
      .innerJoin(users, eq(projectMembers.userId, users.id))
      .innerJoin(orgMembers, and(eq(orgMembers.userId, projectMembers.userId), eq(orgMembers.orgId, orgId)))
      .where(and(eq(projectMembers.projectId, filters.projectId), isNull(users.deletedAt)));

    return {
      exportedAt: new Date().toISOString(),
      type: "users" as const,
      orgId: org.id,
      orgName: org.name,
      filters: { projectId: filters.projectId, taskId: null },
      totalUsers: members.length,
      users: members.map((u) => ({ name: u.name, email: u.email, role: u.role })),
    };
  }

  // Org scope: all members
  const members = await db
    .select({ name: users.name, email: users.email, role: orgMembers.role })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(and(eq(orgMembers.orgId, orgId), isNull(users.deletedAt)));

  return {
    exportedAt: new Date().toISOString(),
    type: "users" as const,
    orgId: org.id,
    orgName: org.name,
    filters: { projectId: null, taskId: null },
    totalUsers: members.length,
    users: members.map((u) => ({ name: u.name, email: u.email, role: u.role })),
  };
};

// type=full — full structure, importable
// org scope → importable with POST /orgs/import
// project scope → importable with POST /orgs/:id/projects/import
export const exportFull = async (
  orgId: string,
  user: User,
  filters: { projectId?: string },
) => {
  const org = await validateOrgAccess(orgId, user);
  const fmtDate = (d: Date | null) => (d ? d.toISOString().split("T")[0] : null);

  // Project scope: full single project
  if (filters.projectId) {
    const [project] = await db
      .select({ id: projects.id, title: projects.title, description: projects.description, status: projects.status })
      .from(projects)
      .where(and(eq(projects.id, filters.projectId), eq(projects.orgId, orgId), isNull(projects.deletedAt)));

    if (!project) throw new NotFoundException(M.PROJECT_NOT_FOUND);

    const taskTree = await fetchTaskTree(filters.projectId);

    const memberRows = await db
      .select({ name: users.name, email: users.email, role: orgMembers.role })
      .from(projectMembers)
      .innerJoin(users, eq(projectMembers.userId, users.id))
      .innerJoin(orgMembers, and(eq(orgMembers.userId, projectMembers.userId), eq(orgMembers.orgId, orgId)))
      .where(and(eq(projectMembers.projectId, filters.projectId), isNull(users.deletedAt)));

    return {
      exportedAt: new Date().toISOString(),
      type: "full" as const,
      orgId: org.id,
      orgName: org.name,
      filters: { projectId: filters.projectId },
      project: { title: project.title, description: project.description ?? null, status: project.status },
      totalMembers: memberRows.length,
      members: memberRows.map((m) => ({ name: m.name, email: m.email, role: m.role })),
      totalTasks: taskTree.length,
      tasks: taskTree,
    };
  }

  // Org scope: full organization
  const orgMemberRows = await db
    .select({ name: users.name, email: users.email, role: orgMembers.role })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(and(eq(orgMembers.orgId, orgId), isNull(users.deletedAt)));

  const projectList = await db
    .select({ id: projects.id, title: projects.title, description: projects.description, status: projects.status })
    .from(projects)
    .where(and(eq(projects.orgId, orgId), isNull(projects.deletedAt)));

  if (projectList.length === 0) {
    return {
      exportedAt: new Date().toISOString(),
      type: "full" as const,
      orgId: org.id,
      orgName: org.name,
      filters: { projectId: null },
      org: { name: org.name, slug: org.slug, description: org.description ?? null },
      totalMembers: orgMemberRows.length,
      members: orgMemberRows.map((m) => ({ name: m.name, email: m.email, role: m.role })),
      totalProjects: 0,
      projects: [] as { title: string; description: string | null; status: string; tasks: unknown[] }[],
    };
  }

  const projectIds = projectList.map((p) => p.id);

  const allRootTasks = await db
    .select({ id: tasks.id, projectId: tasks.projectId, title: tasks.title, description: tasks.description, status: tasks.status, priority: tasks.priority, dueDate: tasks.dueDate })
    .from(tasks)
    .where(and(inArray(tasks.projectId, projectIds), isNull(tasks.parentTaskId), isNull(tasks.deletedAt)));

  const rootTaskIds = allRootTasks.map((t) => t.id);

  const allSubtasks = rootTaskIds.length > 0
    ? await db
        .select({ id: tasks.id, parentTaskId: tasks.parentTaskId, title: tasks.title, description: tasks.description, status: tasks.status, priority: tasks.priority, dueDate: tasks.dueDate })
        .from(tasks)
        .where(and(inArray(tasks.parentTaskId, rootTaskIds), isNull(tasks.deletedAt)))
    : [];

  const allTaskIds = [...rootTaskIds, ...allSubtasks.map((s) => s.id)];

  const allAssigneesRaw = allTaskIds.length > 0
    ? await db
        .select({ taskId: taskAssignees.taskId, email: users.email })
        .from(taskAssignees)
        .innerJoin(users, eq(taskAssignees.userId, users.id))
        .where(and(inArray(taskAssignees.taskId, allTaskIds), isNull(users.deletedAt)))
    : [];

  const assigneeMap: Record<string, string[]> = {};
  allAssigneesRaw.forEach((a) => {
    if (!a.taskId) return;
    if (!assigneeMap[a.taskId]) assigneeMap[a.taskId] = [];
    assigneeMap[a.taskId]!.push(a.email);
  });

  const subtaskMap: Record<string, typeof allSubtasks> = {};
  allSubtasks.forEach((s) => {
    if (!s.parentTaskId) return;
    if (!subtaskMap[s.parentTaskId]) subtaskMap[s.parentTaskId] = [];
    subtaskMap[s.parentTaskId]!.push(s);
  });

  const rootTasksByProject: Record<string, typeof allRootTasks> = {};
  allRootTasks.forEach((t) => {
    if (!rootTasksByProject[t.projectId]) rootTasksByProject[t.projectId] = [];
    rootTasksByProject[t.projectId]!.push(t);
  });

  return {
    exportedAt: new Date().toISOString(),
    type: "full" as const,
    orgId: org.id,
    orgName: org.name,
    filters: { projectId: null },
    org: { name: org.name, slug: org.slug, description: org.description ?? null },
    totalMembers: orgMemberRows.length,
    members: orgMemberRows.map((m) => ({ name: m.name, email: m.email, role: m.role })),
    totalProjects: projectList.length,
    projects: projectList.map((p) => ({
      title: p.title,
      description: p.description ?? null,
      status: p.status,
      tasks: (rootTasksByProject[p.id] ?? []).map((t) => ({
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
      })),
    })),
  };
};

// ─── Imports ──────────────────────────────────────────────────────────────────

export const importTasksIntoProject = async (
  projectId: string,
  taskList: ImportTasksBody["tasks"],
  user: User,
  filters?: { status?: TaskStatus; priority?: TaskPriority },
) => {
  const project = await validateProjectAccess(projectId, user);
  const orgId = project.orgId;

  const filtered = filters
    ? taskList.filter((t) => {
        if (filters.status && (t.status ?? "to_do") !== filters.status) return false;
        if (filters.priority && (t.priority ?? "medium") !== filters.priority) return false;
        return true;
      })
    : taskList;

  if (filtered.length === 0) return { tasksImported: 0, subtasksImported: 0, filtered: taskList.length };

  const allEmails = [
    ...new Set(
      filtered.flatMap((t) => [
        ...(t.assigneeEmails ?? []),
        ...(t.subtasks ?? []).flatMap((s) => s.assigneeEmails ?? []),
      ]),
    ),
  ];
  const emailToUserId = await resolveEmailsToUserIds(orgId, allEmails);

  let taskCount = 0;
  let subtaskCount = 0;

  // Validate business rules before touching the DB
  for (const taskData of filtered) {
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
    for (const taskData of filtered) {
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

  return { tasksImported: taskCount, subtasksImported: subtaskCount, skipped: taskList.length - taskCount };
};

export const importProjectIntoOrg = async (
  orgId: string,
  data: ImportProjectBody,
  user: User,
  filters?: { taskStatus?: TaskStatus; taskPriority?: TaskPriority },
) => {
  await validateOrgAccess(orgId, user);

  const rawTaskList = data.tasks ?? [];

  const taskList = filters
    ? rawTaskList.filter((t) => {
        if (filters.taskStatus && (t.status ?? "to_do") !== filters.taskStatus) return false;
        if (filters.taskPriority && (t.priority ?? "medium") !== filters.taskPriority) return false;
        return true;
      })
    : rawTaskList;

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
    skipped: rawTaskList.length - taskCount,
  };
};

export const importOrganization = async (data: ImportOrgBody, user: User) => {
  // Slug uniqueness check (includes soft-deleted orgs to prevent reuse)
  const [existingSlug] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, data.org.slug));

  if (existingSlug) throw new ConflictException(M.SLUG_TAKEN(data.org.slug));

  const projectList = data.projects ?? [];

  // Validate business rules before touching the DB
  for (const projData of projectList) {
    for (const taskData of projData.tasks ?? []) {
      if (taskData.status === "completed") {
        const incomplete = (taskData.subtasks ?? []).filter((s) => (s.status ?? "to_do") !== "completed");
        if (incomplete.length > 0) {
          throw new BadRequestException(
            `Task "${taskData.title}" in project "${projData.title}": cannot import as completed — ${incomplete.length} subtask(s) are not completed`,
          );
        }
      }
    }
  }

  let createdOrgId = "";
  let projectCount = 0;
  let taskCount = 0;
  let subtaskCount = 0;

  await db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({
        name: data.org.name,
        slug: data.org.slug,
        description: data.org.description ?? null,
      })
      .returning({ id: organizations.id });

    if (!org) throw new InternalServerException(M.IMPORT_ORG_FAILED);
    createdOrgId = org.id;

    for (const projData of projectList) {
      const [project] = await tx
        .insert(projects)
        .values({
          orgId: org.id,
          title: projData.title,
          description: projData.description ?? null,
          status: (projData.status ?? "active") as "active" | "on_hold" | "completed",
          createdBy: user.userId,
        })
        .returning({ id: projects.id });

      if (!project) throw new InternalServerException(M.PROJECT_CREATE_FAILED);
      projectCount++;

      const projTasks = projData.tasks ?? [];

      for (const taskData of projTasks) {
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

        for (const subtask of taskData.subtasks ?? []) {
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
        }
      }

      if (projTasks.length > 0) {
        await reconcileProjectStatus(tx, project.id);
      }
    }
  });

  return {
    orgId: createdOrgId,
    orgName: data.org.name,
    projectsImported: projectCount,
    tasksImported: taskCount,
    subtasksImported: subtaskCount,
  };
};

export const importUsersIntoOrg = async (
  orgId: string,
  userList: ImportUsersBody["users"],
  user: User,
) => {
  await validateOrgAccess(orgId, user);

  // Deduplicate emails within the import list itself
  const seen = new Set<string>();
  const deduped = userList.filter((u) => {
    const key = u.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Find which emails already exist in the system
  const emails = deduped.map((u) => u.email);
  const existingRows = await db
    .select({ email: users.email })
    .from(users)
    .where(inArray(users.email, emails));

  const existingEmails = new Set(existingRows.map((u) => u.email.toLowerCase()));

  const toCreate = deduped.filter((u) => !existingEmails.has(u.email.toLowerCase()));
  const skippedEmails = deduped
    .filter((u) => existingEmails.has(u.email.toLowerCase()))
    .map((u) => u.email);

  if (toCreate.length === 0) {
    return { imported: 0, skipped: skippedEmails.length, skippedEmails };
  }

  // Generate and hash passwords before entering transaction
  const prepared = await Promise.all(
    toCreate.map(async (u) => {
      const tempPassword = randomBytes(8).toString("hex");
      const passwordHash = await bcrypt.hash(tempPassword, 10);
      return { name: u.name, email: u.email, tempPassword, passwordHash };
    }),
  );

  const created = await db.transaction(async (tx) => {
    const results: { id: string; email: string; name: string; tempPassword: string }[] = [];

    for (const userData of prepared) {
      const [newUser] = await tx
        .insert(users)
        .values({
          name: userData.name,
          email: userData.email,
          passwordHash: userData.passwordHash,
          role: "developer",
        })
        .returning({ id: users.id, email: users.email, name: users.name });

      if (!newUser) throw new InternalServerException(M.USER_CREATE_FAILED_IMPORT);

      await tx.insert(orgMembers).values({ orgId, userId: newUser.id, role: "developer" });

      results.push({ ...newUser, tempPassword: userData.tempPassword });
    }

    return results;
  });

  // Send welcome emails outside the transaction — email failure does not roll back user creation
  for (const u of created) {
    const sent = await sendWelcomeEmail(u.email, u.name, u.tempPassword);
    if (!sent) logger.warn(`Welcome email not sent to ${u.email}`, "data-transfer");
  }

  return { imported: created.length, skipped: skippedEmails.length, skippedEmails };
};
