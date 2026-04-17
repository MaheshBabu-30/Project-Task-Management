export const NOTIFICATION_TYPES = [
  "task_assigned",
  "task_due_soon",
  "task_overdue",
  "task_completed",
  "comment_added",
  "member_removed",
] as const;

export type NotificationType = typeof NOTIFICATION_TYPES[number];
