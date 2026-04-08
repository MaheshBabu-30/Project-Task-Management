import { object, string, optional, number, minValue, pipe, picklist, array, boolean } from "valibot";

export const createTaskSchema = object({
  title: string("Task title is required"),
  description: optional(string()),
  priority: optional(picklist(["low", "medium", "high", "urgent"]), "medium"),
  dueDate: optional(string()), // Receive as string (YYYY-MM-DD), parse in service
  projectId: string("projectId is required"),
  assignedUserIds: optional(array(string())) // Support multiple developers
});

export const updateTaskSchema = object({
  title: optional(string()),
  description: optional(string()),
  priority: optional(picklist(["low", "medium", "high", "urgent"])),
  dueDate: optional(string()),
  projectId: optional(string()),
  assignedUserIds: optional(array(string())),
  status: optional(picklist(["to_do", "in_progress", "on_hold", "overdue", "completed"]))
});

export const taskQuerySchema = object({
  id: optional(string()),
  status: optional(picklist(["to_do", "in_progress", "on_hold", "overdue", "completed"])),
  priority: optional(picklist(["low", "medium", "high", "urgent"])),
  search: optional(string()),
  projectId: optional(string()),
  assignedUserId: optional(string()),
  page: optional(pipe(number(), minValue(1))),
  limit: optional(pipe(number(), minValue(1))),
  sortBy: optional(string()),
  order: optional(string()),
  showDeleted: optional(boolean())
});
