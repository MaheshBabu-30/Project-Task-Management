import { parse } from "valibot";
import type { Context } from "hono";
import { auditLogQuerySchema } from "./audit-log.schema.js";
import { getAuditLogs } from "./audit-log.service.js";
import { successResponse } from "../../utils/response.js";
import { buildPagination } from "../../utils/pagination.js";

export const listAuditLogs = async (c: Context) => {
  const user = c.get("user");
  const rawQuery = c.req.query();

  const query = parse(auditLogQuerySchema, {
    ...rawQuery,
    page: rawQuery.page ? Number(rawQuery.page) : 1,
    limit: rawQuery.limit ? Number(rawQuery.limit) : 20,
  });

  // Admin is always scoped to their own org
  const scopedOrgId = user.role === "admin" ? user.orgId : undefined;
  const { data, totalRecords } = await getAuditLogs(query, scopedOrgId);

  const pagination = buildPagination({
    page: query.page as number,
    limit: query.limit as number,
    totalRecords,
  });

  return successResponse(c, { auditLogs: data, pagination });
};
