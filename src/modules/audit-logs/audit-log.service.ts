import { db } from "../../config/db.js";
import { auditLogs } from "../../../drizzle/schema.js";
import { eq, and, gte, lte, ilike, asc, desc, count } from "drizzle-orm";

// ─── Create Audit Log (internal helper) ──────────────────────────────────────

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
    before: data.before ? JSON.stringify(data.before) : undefined,
    after: data.after ? JSON.stringify(data.after) : undefined,
  });
};

// ─── Get Audit Logs ───────────────────────────────────────────────────────────

export const getAuditLogs = async (
  query: {
    page?: number;
    limit?: number;
    orgId?: string;
    actorId?: string;
    entityType?: string;
    action?: string;
    from?: string;
    to?: string;
    sortBy?: string;
    order?: string;
  },
  scopedOrgId?: string  // set for admin — restricts to their org
) => {
  const { page = 1, limit = 20, orgId, actorId, entityType, action, from, to, sortBy = "createdAt", order = "desc" } = query;
  const offset = (page - 1) * limit;

  const filters: any[] = [];

  // Admins are always locked to their org
  const targetOrgId = scopedOrgId ?? orgId;
  if (targetOrgId) filters.push(eq(auditLogs.orgId, targetOrgId));

  if (actorId) filters.push(eq(auditLogs.actorId, actorId));
  if (entityType) filters.push(eq(auditLogs.entityType, entityType));
  if (action) filters.push(ilike(auditLogs.action, `%${action}%`));
  if (from) filters.push(gte(auditLogs.createdAt, new Date(from)));
  if (to) filters.push(lte(auditLogs.createdAt, new Date(`${to}T23:59:59`)));

  const whereCondition = filters.length > 0 ? and(...filters) : undefined;

  const validColumns: Record<string, any> = {
    createdAt: auditLogs.createdAt,
    action: auditLogs.action,
    entityType: auditLogs.entityType,
  };
  const orderColumn = validColumns[sortBy] ?? auditLogs.createdAt;
  const orderDirection = order === "asc" ? asc(orderColumn) : desc(orderColumn);

  const [data, countResult] = await Promise.all([
    db
      .select()
      .from(auditLogs)
      .where(whereCondition)
      .orderBy(orderDirection)
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(auditLogs).where(whereCondition),
  ]);

  return { data, totalRecords: countResult[0]?.total ?? 0 };
};
