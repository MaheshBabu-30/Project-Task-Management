import { db } from "../../config/db.js";
import { auditLogs, users, organizations } from "../../db/schema/index.js";
import { eq, and, gte, lte, ilike, asc, desc, count, inArray, type SQL } from "drizzle-orm";
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
  after: Changes | null
): string => {
  switch (action) {
    case "task.created":    return `${actor} created a new task`;
    case "task.deleted":    return `${actor} deleted a task`;
    case "project.created": return `${actor} created a new project`;
    case "project.deleted": return `${actor} deleted a project`;
    case "user.created":    return `${actor} created a new user account`;
    case "org.created":     return `${actor} created a new organization`;
    case "org.deleted":     return `${actor} deleted the organization`;
    case "org.admin_assigned":   return `${actor} assigned a new admin to the organization`;
    case "org.developer_added":  return `${actor} added a developer to the organization`;
    case "org.member_removed":   return `${actor} removed a member from the organization`;

    case "task.status_updated":
    case "user.status_updated": {
      const entity = action.startsWith("task") ? "task" : "user";
      return `${actor} changed ${entity} status from ${fmt(before?.status)} to ${fmt(after?.status)}`;
    }

    case "task.updated":
    case "project.updated": {
      const entity = action.startsWith("task") ? "task" : "project";
      if (!before || !after) return `${actor} updated a ${entity}`;
      const changed = diffFields(before, after);
      if (changed.length === 0) return `${actor} updated a ${entity}`;
      if (changed.length === 1) {
        const k = changed[0];
        return `${actor} changed ${entity} ${k} from ${fmt(before[k])} to ${fmt(after[k])}`;
      }
      const last = changed.pop()!;
      return `${actor} updated ${entity}: ${changed.join(", ")} and ${last} changed`;
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

  const actorsMap: Record<string, ActorSummary> = {};
  const orgsMap: Record<string, OrgSummary> = {};

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
  ]);

  const data = rawData.map((log) => {
    const actor = log.actorId ? (actorsMap[log.actorId] ?? null) : null;
    const before: Changes | null = log.before ? JSON.parse(log.before) : null;
    const after: Changes | null = log.after ? JSON.parse(log.after) : null;
    const actorLabel = actor?.name ?? actor?.email ?? "Unknown";

    return {
      ...log,
      before,
      after,
      actor,
      organization: log.orgId ? (orgsMap[log.orgId] ?? null) : null,
      description: buildDescription(log.action, actorLabel, before, after),
    };
  });

  return { data, totalRecords: countResult[0]?.total ?? 0 };
};
