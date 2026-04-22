export const NOTIFICATION_TYPES = [
  "task_assigned",
  "task_due_soon",
  "task_overdue",
  "task_completed",
  "comment_added",
  "comment_mentioned",
  "comment_replied",
  "member_added",
  "member_removed",
  "project_assigned",
] as const;

export type NotificationType = typeof NOTIFICATION_TYPES[number];
