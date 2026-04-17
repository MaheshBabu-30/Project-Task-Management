import type { TaskStatus } from "../types/task.types.js";

export const TASK_STATUSES = ["to_do", "in_progress", "on_hold", "overdue", "completed"] as const;
export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export const ALLOWED_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  to_do:       ["in_progress", "on_hold"],
  in_progress: ["on_hold", "completed"],
  on_hold:     ["in_progress", "to_do"],
  completed:   ["in_progress"],
  overdue:     ["in_progress", "on_hold"],
};
