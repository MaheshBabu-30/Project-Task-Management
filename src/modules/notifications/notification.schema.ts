import { object, optional, number, boolean, pipe, minValue, maxValue, picklist } from "valibot";

export const notificationQuerySchema = object({
  page: optional(pipe(number(), minValue(1, "Page must be >= 1"), maxValue(500, "Page must be <= 500"))),
  limit: optional(pipe(number(), minValue(1, "Limit must be >= 1"), maxValue(100, "Limit must be <= 100"))),
  unread: optional(boolean()),
  type: optional(picklist(["task_assigned", "task_due_soon", "task_overdue", "task_completed", "comment_added", "comment_mentioned", "comment_replied", "member_added", "member_removed", "project_assigned"] as const)),
  order: optional(picklist(["asc", "desc"] as const)),
});
