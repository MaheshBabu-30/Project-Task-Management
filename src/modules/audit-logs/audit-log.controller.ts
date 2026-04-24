import { parse } from "valibot";
import type { AppContext } from "../../types/hono.types.js";
import { auditLogQuerySchema } from "./audit-log.schema.js";
import { getAuditLogs } from "./audit-log.service.js";
import { successResponse } from "../../utils/response.js";
import { buildPagination } from "../../helpers/pagination.js";

export const listAuditLogs = async (c: AppContext) => {
  const user = c.get("user");
  const rawQuery = c.req.query();

  const query = parse(auditLogQuerySchema, rawQuery);

  // Admin is always scoped to their own org
  const scopedOrgId = user.role === "admin" ? user.orgId : undefined;
  const { data, totalRecords } = await getAuditLogs(query, scopedOrgId);

  const pagination = buildPagination({
    page: query.page,
    limit: query.limit,
    totalRecords,
  });

  return successResponse(c, { auditLogs: data, pagination });
};
