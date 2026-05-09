import bcrypt from "bcrypt";
import { randomBytes } from "crypto";
import { db } from "../../config/db.js";
import { tasks, projects, taskAssignees, projectMembers, orgMembers, users, organizations } from "../../db/schema/index.js";
import { eq, ilike, and, isNull, inArray, count, sql, gte, lte } from "drizzle-orm";
import { ForbiddenException, NotFoundException, InternalServerException } from "../../exceptions/index.js";
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

// type=organizations — superadmin only
export const exportOrganizations = async (
  user: User,
  filters: { id?: string; name?: string; fromDate?: string; toDate?: string },
) => {
  if (user.role !== "superadmin") throw new ForbiddenException(M.ACCESS_DENIED);

  const conditions: ReturnType<typeof eq>[] = [isNull(organizations.deletedAt) as any];
  if (filters.id) conditions.push(eq(organizations.id, filters.id) as any);
  if (filters.name) conditions.push(ilike(organizations.name, `%${filters.name}%`) as any);
  if (filters.fromDate) conditions.push(gte(organizations.createdAt, new Date(filters.fromDate)) as any);
  if (filters.toDate) conditions.push(lte(organizations.createdAt, new Date(filters.toDate)) as any);

  const orgList = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      description: organizations.description,
      createdAt: organizations.createdAt,
      ownerName: users.name,
      ownerEmail: users.email,
    })
    .from(organizations)
    .leftJoin(users, eq(organizations.ownerId, users.id))
    .where(and(...conditions));

  return {
    message: "Organizations exported successfully",
    exportedAt: new Date().toISOString(),
    type: "organizations" as const,
    filters: { id: filters.id ?? null, name: filters.name ?? null, fromDate: filters.fromDate ?? null, toDate: filters.toDate ?? null },
    totalOrganizations: orgList.length,
    organizations: orgList.map((o) => ({
      id: o.id,
      name: o.name,
      description: o.description ?? null,
      createdAt: o.createdAt?.toISOString() ?? null,
      owner: o.ownerName ? { name: o.ownerName, email: o.ownerEmail } : null,
    })),
  };
};

// type=projects — admin only, scoped to their org
export const exportProjects = async (
  orgId: string,
  user: User,
  filters: { id?: string; title?: string; status?: string; fromDate?: string; toDate?: string },
) => {
  if (user.role !== "admin") throw new ForbiddenException(M.ACCESS_DENIED);
  if (user.orgId !== orgId) throw new ForbiddenException(M.ACCESS_DENIED);

  const conditions: ReturnType<typeof eq>[] = [eq(projects.orgId, orgId) as any, isNull(projects.deletedAt) as any];
  if (filters.id) conditions.push(eq(projects.id, filters.id) as any);
  if (filters.title) conditions.push(ilike(projects.title, `%${filters.title}%`) as any);
  if (filters.status) conditions.push(eq(projects.status, filters.status as any) as any);
  if (filters.fromDate) conditions.push(gte(projects.createdAt, new Date(filters.fromDate)) as any);
  if (filters.toDate) conditions.push(lte(projects.createdAt, new Date(filters.toDate)) as any);

  const projectList = await db
    .select({ id: projects.id, title: projects.title, description: projects.description, status: projects.status, createdAt: projects.createdAt })
    .from(projects)
    .where(and(...conditions));

  if (filters.id && projectList.length === 0) throw new NotFoundException(M.PROJECT_NOT_FOUND);

  const projectIds = projectList.map((p) => p.id);
  const membersMap: Record<string, { name: string; email: string }[]> = {};

  if (projectIds.length > 0) {
    const allMembers = await db
      .select({ projectId: projectMembers.projectId, name: users.name, email: users.email })
      .from(projectMembers)
      .innerJoin(users, eq(projectMembers.userId, users.id))
      .where(and(inArray(projectMembers.projectId, projectIds), isNull(users.deletedAt)));

    allMembers.forEach((m) => {
      if (!m.projectId) return;
      if (!membersMap[m.projectId]) membersMap[m.projectId] = [];
      membersMap[m.projectId]!.push({ name: m.name, email: m.email });
    });
  }

  return {
    message: "Projects exported successfully",
    exportedAt: new Date().toISOString(),
    type: "projects" as const,
    filters: { id: filters.id ?? null, title: filters.title ?? null, status: filters.status ?? null, fromDate: filters.fromDate ?? null, toDate: filters.toDate ?? null },
    totalProjects: projectList.length,
    projects: projectList.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description ?? null,
      status: p.status,
      createdAt: p.createdAt?.toISOString() ?? null,
      assignedMembers: membersMap[p.id] ?? [],
    })),
  };
};

// type=tasks — admin only, scoped to their org
export const exportTasks = async (
  orgId: string,
  user: User,
  filters: { id?: string; title?: string; projectId?: string; status?: TaskStatus; priority?: TaskPriority; dueDateFrom?: string; dueDateTo?: string },
) => {
  if (user.role !== "admin") throw new ForbiddenException(M.ACCESS_DENIED);
  if (user.orgId !== orgId) throw new ForbiddenException(M.ACCESS_DENIED);

  const fmtDate = (d: Date | null) => (d ? d.toISOString().split("T")[0] : null);

  const activeFilters = {
    id: filters.id ?? null,
    title: filters.title ?? null,
    projectId: filters.projectId ?? null,
    status: filters.status ?? null,
    priority: filters.priority ?? null,
    dueDateFrom: filters.dueDateFrom ?? null,
    dueDateTo: filters.dueDateTo ?? null,
  };

  const empty = () => ({ message: "Tasks exported successfully", exportedAt: new Date().toISOString(), type: "tasks" as const, filters: activeFilters, totalTasks: 0, tasks: [] as unknown[] });

  if (filters.projectId) {
    const [proj] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, filters.projectId), eq(projects.orgId, orgId), isNull(projects.deletedAt)));
    if (!proj) throw new NotFoundException(M.PROJECT_NOT_FOUND);
  }

  const projectList = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(and(eq(projects.orgId, orgId), isNull(projects.deletedAt), filters.projectId ? eq(projects.id, filters.projectId) : undefined));

  if (projectList.length === 0) return empty();

  const projectMap: Record<string, string> = {};
  projectList.forEach((p) => { projectMap[p.id] = p.title; });
  const projectIds = projectList.map((p) => p.id);

  const taskConditions: ReturnType<typeof eq>[] = [
    inArray(tasks.projectId, projectIds) as any,
    isNull(tasks.parentTaskId) as any,
    isNull(tasks.deletedAt) as any,
  ];
  if (filters.id) taskConditions.push(eq(tasks.id, filters.id) as any);
  if (filters.title) taskConditions.push(ilike(tasks.title, `%${filters.title}%`) as any);
  if (filters.status) taskConditions.push(eq(tasks.status, filters.status) as any);
  if (filters.priority) taskConditions.push(eq(tasks.priority, filters.priority) as any);
  if (filters.dueDateFrom) taskConditions.push(gte(tasks.dueDate, new Date(filters.dueDateFrom)) as any);
  if (filters.dueDateTo) taskConditions.push(lte(tasks.dueDate, new Date(filters.dueDateTo)) as any);

  const taskList = await db
    .select({ id: tasks.id, projectId: tasks.projectId, title: tasks.title, status: tasks.status, priority: tasks.priority, dueDate: tasks.dueDate })
    .from(tasks)
    .where(and(...taskConditions));

  if (taskList.length === 0) return empty();

  const taskIds = taskList.map((t) => t.id);
  const assigneeRows = await db
    .select({ taskId: taskAssignees.taskId, name: users.name, email: users.email })
    .from(taskAssignees)
    .innerJoin(users, eq(taskAssignees.userId, users.id))
    .where(and(inArray(taskAssignees.taskId, taskIds), isNull(users.deletedAt)));

  const assigneeMap: Record<string, { name: string; email: string }[]> = {};
  assigneeRows.forEach((a) => {
    if (!a.taskId) return;
    if (!assigneeMap[a.taskId]) assigneeMap[a.taskId] = [];
    assigneeMap[a.taskId]!.push({ name: a.name, email: a.email });
  });

  return {
    message: "Tasks exported successfully",
    exportedAt: new Date().toISOString(),
    type: "tasks" as const,
    filters: activeFilters,
    totalTasks: taskList.length,
    tasks: taskList.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      projectId: t.projectId,
      projectTitle: projectMap[t.projectId] ?? null,
      dueDate: fmtDate(t.dueDate),
      assignedMembers: assigneeMap[t.id] ?? [],
    })),
  };
};

// type=users — superadmin (admins only, optional orgId filter) or admin (developers in their org)
export const exportUsers = async (
  user: User,
  filters: { id?: string; name?: string; status?: string; orgId?: string },
) => {
  if (user.role === "superadmin") {
    const conditions: ReturnType<typeof eq>[] = [eq(orgMembers.role, "admin") as any, isNull(users.deletedAt) as any];
    if (filters.orgId) conditions.push(eq(orgMembers.orgId, filters.orgId) as any);
    if (filters.id) conditions.push(eq(users.id, filters.id) as any);
    if (filters.name) conditions.push(ilike(users.name, `%${filters.name}%`) as any);
    if (filters.status) conditions.push(eq(users.status, filters.status as any) as any);

    const memberList = await db
      .select({ id: users.id, name: users.name, email: users.email, role: orgMembers.role, status: users.status, phone: users.phone, createdAt: users.createdAt })
      .from(orgMembers)
      .innerJoin(users, eq(orgMembers.userId, users.id))
      .where(and(...conditions));

    return {
      message: "Users exported successfully",
      exportedAt: new Date().toISOString(),
      type: "users" as const,
      filters: { id: filters.id ?? null, name: filters.name ?? null, orgId: filters.orgId ?? null, status: filters.status ?? null },
      totalUsers: memberList.length,
      users: memberList.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.status,
        phone: u.phone ?? null,
        createdAt: u.createdAt?.toISOString() ?? null,
      })),
    };
  }

  if (user.role !== "admin") throw new ForbiddenException(M.ACCESS_DENIED);
  const orgId = user.orgId!;

  const conditions: ReturnType<typeof eq>[] = [
    eq(orgMembers.orgId, orgId) as any,
    eq(orgMembers.role, "developer") as any,
    isNull(users.deletedAt) as any,
  ];
  if (filters.id) conditions.push(eq(users.id, filters.id) as any);
  if (filters.name) conditions.push(ilike(users.name, `%${filters.name}%`) as any);
  if (filters.status) conditions.push(eq(users.status, filters.status as any) as any);

  const memberList = await db
    .select({ id: users.id, name: users.name, email: users.email, role: orgMembers.role, status: users.status, phone: users.phone, createdAt: users.createdAt })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(and(...conditions));

  return {
    message: "Users exported successfully",
    exportedAt: new Date().toISOString(),
    type: "users" as const,
    filters: { id: filters.id ?? null, name: filters.name ?? null, status: filters.status ?? null },
    totalUsers: memberList.length,
    users: memberList.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      phone: u.phone ?? null,
      createdAt: u.createdAt?.toISOString() ?? null,
    })),
  };
};

// ─── Imports ──────────────────────────────────────────────────────────────────

export const importOrganization = async (data: ImportOrgBody) => {
  const slugs = data.orgs.map((o) => o.slug);
  const names = data.orgs.map((o) => o.name);

  const [existingSlugRows, existingNameRows] = await Promise.all([
    db.select({ slug: organizations.slug }).from(organizations).where(inArray(organizations.slug, slugs)),
    db.select({ name: organizations.name }).from(organizations).where(and(inArray(organizations.name, names), isNull(organizations.deletedAt))),
  ]);

  const existingSlugs = new Set(existingSlugRows.map((r) => r.slug));
  const existingNames = new Set(existingNameRows.map((r) => r.name));

  const skippedOrgs = data.orgs
    .filter((o) => existingSlugs.has(o.slug) || existingNames.has(o.name))
    .map((o) => ({
      name: o.name,
      slug: o.slug,
      reason: existingSlugs.has(o.slug) ? "Organization with this slug already exists" : "Organization with this name already exists",
    }));

  const toCreate = data.orgs.filter((o) => !existingSlugs.has(o.slug) && !existingNames.has(o.name));

  if (toCreate.length === 0) {
    return { message: "Organizations imported successfully", imported: 0, skipped: skippedOrgs.length, skippedOrgs, orgs: [] };
  }

  const created = await db.transaction(async (tx) => {
    const results: { orgId: string; orgName: string; description: string | null }[] = [];
    for (const orgData of toCreate) {
      const [org] = await tx
        .insert(organizations)
        .values({ name: orgData.name, slug: orgData.slug, description: orgData.description ?? null })
        .returning({ id: organizations.id });
      if (!org) throw new InternalServerException(M.IMPORT_ORG_FAILED);
      results.push({ orgId: org.id, orgName: orgData.name, description: orgData.description ?? null });
    }
    return results;
  });

  return {
    message: "Organizations imported successfully",
    imported: created.length,
    skipped: skippedOrgs.length,
    skippedOrgs,
    orgs: created,
  };
};

export const importProjectIntoOrg = async (data: ImportProjectBody, user: User) => {
  if (!user.orgId) throw new ForbiddenException("No organization associated with your account");
  const orgId = user.orgId;

  await validateOrgAccess(orgId, user);

  const titles = data.projects.map((p) => p.title);
  const existingTitleRows = await db
    .select({ title: projects.title })
    .from(projects)
    .where(and(eq(projects.orgId, orgId), inArray(projects.title, titles), isNull(projects.deletedAt)));

  const existingTitles = new Set(existingTitleRows.map((r) => r.title));

  const skippedProjects = data.projects
    .filter((p) => existingTitles.has(p.title))
    .map((p) => ({ title: p.title, reason: "Project already exists in this organization" }));

  const toCreate = data.projects.filter((p) => !existingTitles.has(p.title));

  if (toCreate.length === 0) {
    return { message: "Projects imported successfully", imported: 0, skipped: skippedProjects.length, skippedProjects, projects: [] };
  }

  const allEmails = [...new Set(toCreate.flatMap((p) => p.assigneeEmails ?? []))];
  const emailToUserId = await resolveEmailsToUserIds(orgId, allEmails);

  const created = await db.transaction(async (tx) => {
    const results: { projectId: string; projectTitle: string; description: string | null; skippedAssignees: { email: string; reason: string }[] }[] = [];

    for (const projectData of toCreate) {
      const assigneeEmails = projectData.assigneeEmails ?? [];
      const skippedAssignees = assigneeEmails
        .filter((e) => !emailToUserId[e])
        .map((email) => ({ email, reason: "Not a member of this organization" }));
      const assigneeIds = [...new Set(assigneeEmails.map((e) => emailToUserId[e]).filter((id): id is string => !!id))];

      const [project] = await tx
        .insert(projects)
        .values({
          orgId,
          title: projectData.title,
          description: projectData.description ?? null,
          status: "active",
          createdBy: user.userId,
        })
        .returning({ id: projects.id });

      if (!project) throw new InternalServerException(M.PROJECT_CREATE_FAILED);

      if (assigneeIds.length > 0) {
        await tx.insert(projectMembers).values(assigneeIds.map((userId) => ({ projectId: project.id, userId }))).onConflictDoNothing();
      }

      results.push({ projectId: project.id, projectTitle: projectData.title, description: projectData.description ?? null, skippedAssignees });
    }

    return results;
  });

  return {
    message: "Projects imported successfully",
    imported: created.length,
    skipped: skippedProjects.length,
    skippedProjects,
    projects: created,
  };
};

export const importTasksIntoProject = async (
  projectId: string,
  taskList: ImportTasksBody["tasks"],
  user: User,
) => {
  const project = await validateProjectAccess(projectId, user);
  const orgId = project.orgId;

  const titles = taskList.map((t) => t.title);
  const existingTitleRows = await db
    .select({ title: tasks.title })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), inArray(tasks.title, titles), isNull(tasks.deletedAt)));

  const existingTitles = new Set(existingTitleRows.map((r) => r.title));

  const skippedTasks = taskList
    .filter((t) => existingTitles.has(t.title))
    .map((t) => ({ title: t.title, reason: "Task already exists in this project" }));

  const toCreate = taskList.filter((t) => !existingTitles.has(t.title));

  const allEmails = [...new Set(toCreate.flatMap((t) => t.assigneeEmails ?? []))];
  const emailToUserId = await resolveEmailsToUserIds(orgId, allEmails);

  const skippedAssignees = allEmails
    .filter((e) => !emailToUserId[e])
    .map((email) => ({ email, reason: "Not a member of this organization" }));

  if (toCreate.length === 0) {
    return { message: "Tasks imported successfully", tasksImported: 0, skipped: skippedTasks.length, skippedTasks, skippedAssignees, tasks: [] };
  }

  const createdTasks: { taskId: string; title: string; priority: string; dueDate: string | null }[] = [];

  await db.transaction(async (tx) => {
    for (const taskData of toCreate) {
      const assigneeIds = [
        ...new Set(
          (taskData.assigneeEmails ?? [])
            .map((e) => emailToUserId[e])
            .filter((id): id is string => !!id),
        ),
      ];

      const [task] = await tx
        .insert(tasks)
        .values({
          projectId,
          title: taskData.title,
          description: taskData.description ?? null,
          priority: (taskData.priority ?? "medium") as TaskPriority,
          status: "to_do",
          dueDate: taskData.dueDate ? new Date(taskData.dueDate) : null,
          createdBy: user.userId,
        })
        .returning({ id: tasks.id });

      if (!task) throw new InternalServerException(M.TASK_CREATE_FAILED);

      if (assigneeIds.length > 0) {
        await tx.insert(taskAssignees).values(assigneeIds.map((userId) => ({ taskId: task.id, userId })));
        await tx.insert(projectMembers).values(assigneeIds.map((userId) => ({ projectId, userId }))).onConflictDoNothing();
      }

      createdTasks.push({
        taskId: task.id,
        title: taskData.title,
        priority: taskData.priority ?? "medium",
        dueDate: taskData.dueDate ?? null,
      });
    }

    await reconcileProjectStatus(tx, projectId);
  });

  return {
    message: "Tasks imported successfully",
    tasksImported: createdTasks.length,
    skipped: skippedTasks.length,
    skippedTasks,
    skippedAssignees,
    tasks: createdTasks,
  };
};

export const importUsersIntoOrg = async (
  userList: ImportUsersBody["users"],
  user: User,
  orgId?: string,
) => {
  const assignedRole = user.role === "superadmin" ? "admin" : "developer";

  if (user.role === "admin") {
    if (!orgId) throw new ForbiddenException("No organization associated with your account");
    await validateOrgAccess(orgId, user);
  }

  const seen = new Set<string>();
  const deduped = userList.filter((u) => {
    const key = u.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const emails = deduped.map((u) => u.email);
  const existingRows = await db
    .select({ email: users.email })
    .from(users)
    .where(inArray(users.email, emails));

  const existingEmails = new Set(existingRows.map((u) => u.email.toLowerCase()));
  const toCreate = deduped.filter((u) => !existingEmails.has(u.email.toLowerCase()));
  const skippedUsers = deduped
    .filter((u) => existingEmails.has(u.email.toLowerCase()))
    .map((u) => ({ email: u.email, reason: "Email already exist" }));

  if (toCreate.length === 0) {
    return { message: "Users imported successfully", imported: 0, skipped: skippedUsers.length, skippedUsers, users: [] };
  }

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
          role: assignedRole,
        })
        .returning({ id: users.id, email: users.email, name: users.name });

      if (!newUser) throw new InternalServerException(M.USER_CREATE_FAILED_IMPORT);

      if (user.role === "admin" && orgId) {
        await tx.insert(orgMembers).values({ orgId, userId: newUser.id, role: "developer" });
      }

      results.push({ ...newUser, tempPassword: userData.tempPassword });
    }

    return results;
  });

  for (const u of created) {
    const sent = await sendWelcomeEmail(u.email, u.name, u.tempPassword);
    if (!sent) logger.warn(`Welcome email not sent to ${u.email}`, "data-transfer");
  }

  return {
    message: "Users imported successfully",
    imported: created.length,
    skipped: skippedUsers.length,
    skippedUsers,
    users: created.map((u) => ({ userId: u.id, name: u.name, email: u.email, role: assignedRole })),
  };
};
