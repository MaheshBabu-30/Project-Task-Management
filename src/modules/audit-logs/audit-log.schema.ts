import { object, optional, string, number, pipe, picklist, uuid, minValue, maxValue, regex } from "valibot";

export const auditLogQuerySchema = object({
  page: optional(pipe(number(), minValue(1))),
  limit: optional(pipe(number(), minValue(1), maxValue(100))),
  orgId: optional(pipe(string(), uuid())),
  actorId: optional(pipe(string(), uuid())),
  entityType: optional(picklist(["task", "project", "user", "org"] as const)),
  action: optional(string()),
  from: optional(pipe(string(), regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"))),
  to: optional(pipe(string(), regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"))),
});
