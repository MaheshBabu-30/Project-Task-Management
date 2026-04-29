import { db } from "../../config/db.js";
import { auditLogs, users, organizations, projects, tasks } from "../../db/schema/index.js";
import { eq, and, gte, lte, ilike, asc, desc, count, inArray, isNull, type SQL } from "drizzle-orm";
import type { PaginationQuery } from "../../types/common.types.js";

interface AuditLogQuery extends PaginationQuery {
  orgId?: string;
  actorId?: string;
  entityType?: string;
  action?: string;
  from?: string;
  to?: string;
}

// ─── Create Audit Log (internal helper) ──────────────────────────────────────

const SENSITIVE_FIELDS = new Set(["passwordHash", "otpHash", "tokenHash", "refreshTokenHash"]);

const sanitize = (obj: object): object => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!SENSITIVE_FIELDS.has(k)) out[k] = v;
  }
  return out;
};

export const createAuditLog = async (data: {
  orgId?: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: object;
  after?: object;
  ipAddress?: string;
}) => {
  await db.insert(auditLogs).values({
    ...data,
    before: data.before ? JSON.stringify(sanitize(data.before)) : undefined,
    after: data.after ? JSON.stringify(sanitize(data.after)) : undefined,
  });
};

// ─── Description Generator ───────────────────────────────────────────────────

type Changes = Record<string, unknown>;

// Fields that carry no meaning in a human-readable diff (metadata, joined data)
const DIFF_SKIP = new Set([
  "id", "orgId", "orgName", "projectId", "projectName",
  "createdBy", "createdAt", "updatedAt", "deletedAt",
  "assignees", "creator", "members", "taskCount",
  "completedAt", "avatarUrl", "lastLoginAt",
]);

const fmt = (v: unknown): string => {
  if (v === null || v === undefined) return "none";
  if (typeof v === "string") return `'${v}'`;
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
};

const diffFields = (before: Changes, after: Changes): string[] =>
  Object.keys(after).filter(
    (k) => !DIFF_SKIP.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k])
  );

const buildDescription = (
  action: string,
  actor: string,
  before: Changes | null,
  after: Changes | null,
  entityName: string | null,
  projectName: string | null,
): string => {
  const taskRef = entityName
    ? (projectName ? `task '${entityName}' in project '${projectName}'` : `task '${entityName}'`)
    : "a task";
  const projectRef = entityName ? `project '${entityName}'` : "a project";
  const orgRef = entityName ? `organization '${entityName}'` : "the organization";

  switch (action) {
    case "task.created":    return `${actor} created ${taskRef}`;
    case "task.deleted":    return `${actor} deleted ${taskRef}`;
    case "project.created": return `${actor} created ${projectRef}`;
    case "project.deleted": return `${actor} deleted ${projectRef}`;
    case "user.created": {
      const name = (after?.name ?? after?.email) as string | undefined;
      return name ? `${actor} created user account for '${name}'` : `${actor} created a new user account`;
    }
    case "org.created":     return `${actor} created ${orgRef}`;
    case "org.deleted":     return `${actor} deleted ${orgRef}`;
    case "org.admin_assigned": {
      const name = after?.userName as string | undefined;
      return name ? `${actor} assigned '${name}' as admin of ${orgRef}` : `${actor} assigned a new admin to ${orgRef}`;
    }
    case "org.developer_added": {
      const name = after?.userName as string | undefined;
      return name ? `${actor} added '${name}' as developer to ${orgRef}` : `${actor} added a developer to ${orgRef}`;
    }
    case "org.member_removed": {
      const name = after?.userName as string | undefined;
      return name ? `${actor} removed '${name}' from ${orgRef}` : `${actor} removed a member from ${orgRef}`;
    }

    case "task.status_updated":
      return `${actor} changed ${taskRef} status from ${fmt(before?.status)} to ${fmt(after?.status)}`;

    case "user.status_updated": {
      const name = (before?.name ?? before?.email) as string | undefined;
      const userRef = name ? `user '${name}'` : "user";
      return `${actor} changed ${userRef} status from ${fmt(before?.status)} to ${fmt(after?.status)}`;
    }

    case "task.updated": {
      if (!before || !after) return `${actor} updated ${taskRef}`;
      const changed = diffFields(before, after);
      if (changed.length === 0) return `${actor} updated ${taskRef}`;
      const parts = changed.map((k) => `${k} from ${fmt(before[k])} to ${fmt(after[k])}`);
      if (parts.length === 1) return `${actor} changed ${taskRef} ${parts[0]}`;
      const last = parts.pop()!;
      return `${actor} updated ${taskRef}: ${parts.join(", ")} and ${last}`;
    }

    case "project.updated": {
      if (!before || !after) return `${actor} updated ${projectRef}`;
      const changed = diffFields(before, after);
      if (changed.length === 0) return `${actor} updated ${projectRef}`;
      const parts = changed.map((k) => `${k} from ${fmt(before[k])} to ${fmt(after[k])}`);
      if (parts.length === 1) return `${actor} changed ${projectRef} ${parts[0]}`;
      const last = parts.pop()!;
      return `${actor} updated ${projectRef}: ${parts.join(", ")} and ${last}`;
    }

    default:
      return `${actor} performed: ${action}`;
  }
};

// ─── Get Audit Logs ───────────────────────────────────────────────────────────

export const getAuditLogs = async (
  query: AuditLogQuery,
  scopedOrgId?: string  // set for admin — restricts to their org
) => {
  const { page = 1, limit = 20, orgId, actorId, entityType, action, from, to, sortBy = "createdAt", order = "desc" } = query;
  const offset = (page - 1) * limit;

  type ActorSummary = { id: string; name: string | null; email: string };
  type OrgSummary = { id: string; name: string; slug: string };

  const filters: SQL<unknown>[] = [];

  // Admins are always locked to their org
  const targetOrgId = scopedOrgId ?? orgId;
  if (targetOrgId) filters.push(eq(auditLogs.orgId, targetOrgId));

  if (actorId) filters.push(eq(auditLogs.actorId, actorId));
  if (entityType) filters.push(eq(auditLogs.entityType, entityType));
  if (action) filters.push(ilike(auditLogs.action, `%${action}%`));
  if (from) filters.push(gte(auditLogs.createdAt, new Date(from)));
  if (to) filters.push(lte(auditLogs.createdAt, new Date(`${to}T23:59:59`)));

  const whereCondition = filters.length > 0 ? and(...filters) : undefined;

  const validColumns = {
    createdAt: auditLogs.createdAt,
    action: auditLogs.action,
    entityType: auditLogs.entityType,
  } as const;
  const orderColumn = (sortBy in validColumns ? validColumns[sortBy as keyof typeof validColumns] : auditLogs.createdAt);
  const orderDirection = order === "asc" ? asc(orderColumn) : desc(orderColumn);

  const [rawData, countResult] = await Promise.all([
    db
      .select()
      .from(auditLogs)
      .where(whereCondition)
      .orderBy(orderDirection)
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(auditLogs).where(whereCondition),
  ]);

  // Batch fetch actors and organizations
  const actorIds = [...new Set(rawData.map((l) => l.actorId).filter(Boolean))] as string[];
  const orgIds = [...new Set(rawData.map((l) => l.orgId).filter(Boolean))] as string[];

  // Separate entity IDs by type for name lookups
  const projectEntityIds = [...new Set(rawData.filter((l) => l.entityType === "project").map((l) => l.entityId))];
  const taskEntityIds    = [...new Set(rawData.filter((l) => l.entityType === "task").map((l) => l.entityId))];
  const userEntityIds    = [...new Set(rawData.filter((l) => l.entityType === "user").map((l) => l.entityId))];

  const actorsMap: Record<string, ActorSummary> = {};
  const orgsMap: Record<string, OrgSummary> = {};
  const entityNameMap: Record<string, string> = {};   // entityId → title/name
  const taskProjectMap: Record<string, string> = {};  // taskId   → project name

  await Promise.all([
    actorIds.length > 0
      ? db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, actorIds))
          .then((rows) => rows.forEach((r) => { actorsMap[r.id] = r; }))
      : Promise.resolve(),

    orgIds.length > 0
      ? db
          .select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
          .from(organizations)
          .where(inArray(organizations.id, orgIds))
          .then((rows) => rows.forEach((r) => { orgsMap[r.id] = r; }))
      : Promise.resolve(),

    projectEntityIds.length > 0
      ? db
          .select({ id: projects.id, title: projects.title })
          .from(projects)
          .where(inArray(projects.id, projectEntityIds))
          .then((rows) => rows.forEach((r) => { entityNameMap[r.id] = r.title; }))
      : Promise.resolve(),

    taskEntityIds.length > 0
      ? db
          .select({ id: tasks.id, title: tasks.title, projectTitle: projects.title })
          .from(tasks)
          .leftJoin(projects, and(eq(tasks.projectId, projects.id), isNull(projects.deletedAt)))
          .where(inArray(tasks.id, taskEntityIds))
          .then((rows) => rows.forEach((r) => {
            entityNameMap[r.id] = r.title;
            if (r.projectTitle) taskProjectMap[r.id] = r.projectTitle;
          }))
      : Promise.resolve(),

    userEntityIds.length > 0
      ? db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, userEntityIds))
          .then((rows) => rows.forEach((r) => { entityNameMap[r.id] = r.name ?? r.email; }))
      : Promise.resolve(),
  ]);

  const computeChanges = (before: Changes | null, after: Changes | null) => {
    if (!before || !after) return [];
    return diffFields(before, after).map((field) => ({
      field,
      from: before[field] ?? null,
      to: after[field] ?? null,
    }));
  };

  const data = rawData.map((log) => {
    const actor = log.actorId ? (actorsMap[log.actorId] ?? null) : null;
    const before: Changes | null = log.before ? JSON.parse(log.before) : null;
    const after: Changes | null = log.after ? JSON.parse(log.after) : null;
    const actorLabel = actor?.name ?? actor?.email ?? "Unknown";
    const entityName = entityNameMap[log.entityId]
      ?? (log.entityType === "organization" ? (orgsMap[log.entityId]?.name ?? null) : null)
      ?? (after as Changes | null)?.title as string | undefined
      ?? (before as Changes | null)?.title as string | undefined
      ?? null;
    const projectName = log.entityType === "task" ? (taskProjectMap[log.entityId] ?? null) : null;

    return {
      ...log,
      entityName,
      projectName,
      before,
      after,
      changes: computeChanges(before, after),
      actor,
      organization: log.orgId ? (orgsMap[log.orgId] ?? null) : null,
      description: buildDescription(log.action, actorLabel, before, after, entityName, projectName),
    };
  });

  return { data, totalRecords: countResult[0]?.total ?? 0 };
};
