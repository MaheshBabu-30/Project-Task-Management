import { object, optional, string, pipe, picklist, uuid, regex, check } from "valibot";
import { pageSchema, limitSchema } from "../../helpers/validators.js";

const AUDIT_ACTIONS = [
  "org.created", "org.deleted", "org.admin_assigned", "org.developer_added", "org.member_removed",
  "user.created", "user.updated", "user.deleted", "user.status_updated",
  "project.created", "project.updated", "project.deleted",
  "task.created", "task.updated", "task.deleted", "task.status_updated",
] as const;

export const auditLogQuerySchema = object({
  page: pageSchema,
  limit: limitSchema,
  id: optional(pipe(string(), uuid())),
  orgId: optional(pipe(string(), uuid())),
  actorId: optional(pipe(string(), uuid())),
  entityId: optional(pipe(string(), uuid())),
  entityType: optional(picklist(["task", "project", "user", "org"] as const)),
  action: optional(picklist(AUDIT_ACTIONS, "Invalid action value")),
  from: optional(pipe(string(), regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"), check((v) => !isNaN(Date.parse(v)), "Invalid from date"))),
  to: optional(pipe(string(), regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"), check((v) => !isNaN(Date.parse(v)), "Invalid to date"))),
  sortBy: optional(picklist(["createdAt", "action", "entityType"] as const)),
  order: optional(picklist(["asc", "desc"] as const)),
});
