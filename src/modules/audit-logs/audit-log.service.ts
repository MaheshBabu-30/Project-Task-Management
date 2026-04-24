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

  const data = rawData.map((log) => ({
    ...log,
    actor: log.actorId ? (actorsMap[log.actorId] ?? null) : null,
    organization: log.orgId ? (orgsMap[log.orgId] ?? null) : null,
  }));

  return { data, totalRecords: countResult[0]?.total ?? 0 };
};
