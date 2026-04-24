import { object, optional, picklist } from "valibot";
import { pageSchema, limitSchema, booleanStringSchema } from "../../helpers/validators.js";

export const notificationQuerySchema = object({
  page: pageSchema,
  limit: limitSchema,
  unread: booleanStringSchema,
  type: optional(picklist(["task_assigned", "task_due_soon", "task_overdue", "task_completed", "comment_added", "comment_mentioned", "comment_replied", "member_added", "member_removed", "project_assigned"] as const)),
  order: optional(picklist(["asc", "desc"] as const)),
});
