import { object, string, optional, number, minValue, pipe, picklist, array, date, boolean } from "valibot";

export const createTaskSchema = object({
  title: string(),
  description: optional(string()),
  priority: optional(picklist(["URGENT", "HIGH", "MEDIUM", "LOW"])),
  dueDate: optional(string()), // Receive as string, parse as Date in service
  projectId: number(),
  assignedUserIds: array(number()) // Support multiple developers
});

export const updateTaskSchema = object({
  title: optional(string()),
  description: optional(string()),
  priority: optional(picklist(["URGENT", "HIGH", "MEDIUM", "LOW"])),
  dueDate: optional(string()),
  projectId: optional(number()),
  assignedUserIds: optional(array(number())),
  status: optional(string())
});

export const taskQuerySchema = object({
  id: optional(string()),
  status: optional(string()),
  priority: optional(string()),
  search: optional(string()),
  projectId: optional(string()),
  assignedUserId: optional(string()),
  page: optional(pipe(number(), minValue(1))),
  limit: optional(pipe(number(), minValue(1))),
  sortBy: optional(string()),
  order: optional(string()),
  showDeleted: optional(boolean())
});
