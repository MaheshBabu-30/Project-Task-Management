import { taskStatusEnum, taskPriorityEnum } from "../db/schema/index.js";
import type { TaskStatus } from "../types/task.types.js";

// Derived directly from the DB enum — single source of truth
export const TASK_STATUSES   = taskStatusEnum.enumValues;
export const TASK_PRIORITIES = taskPriorityEnum.enumValues;

export const ALLOWED_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  to_do:       ["in_progress", "on_hold", "completed"],
  in_progress: ["on_hold", "completed"],
  on_hold:     ["in_progress"],
  completed:   ["to_do"],
  overdue:     ["completed"],
};
