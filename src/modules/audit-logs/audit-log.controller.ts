import { parse } from "valibot";
import type { AppContext } from "../../types/hono.types.js";
import { auditLogQuerySchema } from "./audit-log.schema.js";
import { getAuditLogs } from "./audit-log.service.js";
import { successResponse } from "../../utils/response.js";
import { buildPagination } from "../../helpers/pagination.js";
import { BadRequestException, ForbiddenException } from "../../exceptions/index.js";

export const listAuditLogs = async (c: AppContext) => {
  const user = c.get("user");
  const rawQuery = c.req.query();

  const query = parse(auditLogQuerySchema, rawQuery);

  let scopedOrgId: string;

  if (user.role === "superadmin") {
    if (!query.orgId) throw new BadRequestException("orgId query param is required");
    scopedOrgId = query.orgId;
  } else {
    if (!user.orgId) throw new ForbiddenException("No organization associated with your account");
    scopedOrgId = user.orgId;
  }

  const { data, totalRecords } = await getAuditLogs(query, scopedOrgId);

  const pagination = buildPagination({
    page: query.page,
    limit: query.limit,
    totalRecords,
  });

  return successResponse(c, { auditLogs: data, pagination });
};
