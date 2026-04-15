import { object, string, optional, number, minValue, maxValue, pipe, picklist, array, boolean, uuid, minLength, maxLength, regex } from "valibot";

export const createTaskSchema = object({
  title: pipe(string(), minLength(1, "Title is required"), maxLength(300, "Title must be at most 300 characters")),
  description: optional(pipe(string(), maxLength(5000, "Description too long"))),
  priority: optional(picklist(["low", "medium", "high", "urgent"] as const)),
  dueDate: optional(pipe(string(), regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"))),
  projectId: pipe(string("projectId is required"), uuid("Invalid project ID")),
  parentTaskId: optional(pipe(string(), uuid("Invalid parent task ID"))),
  assignedUserIds: optional(array(pipe(string(), uuid()))),
});

export const updateTaskSchema = object({
  title: optional(pipe(string(), minLength(1, "Title is required"), maxLength(300, "Title must be at most 300 characters"))),
  description: optional(pipe(string(), maxLength(5000, "Description too long"))),
  priority: optional(picklist(["low", "medium", "high", "urgent"] as const)),
  dueDate: optional(pipe(string(), regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"))),
  assignedUserIds: optional(array(pipe(string(), uuid()))),
  status: optional(picklist(["to_do", "in_progress", "on_hold", "completed"] as const)),
  // projectId intentionally excluded — tasks cannot be moved between projects
});

// For PATCH /tasks/:id/status — developer + admin
export const updateTaskStatusSchema = object({
  status: picklist(["to_do", "in_progress", "on_hold", "completed"] as const, "Invalid status"),
});

export const taskQuerySchema = object({
  id: optional(pipe(string(), uuid())),
  status: optional(picklist(["to_do", "in_progress", "on_hold", "overdue", "completed"] as const)),
  priority: optional(picklist(["low", "medium", "high", "urgent"] as const)),
  search: optional(string()),
  projectId: optional(pipe(string(), uuid())),
  parentTaskId: optional(pipe(string(), uuid())),
  assignedUserId: optional(pipe(string(), uuid())),
  page: optional(pipe(number(), minValue(1))),
  limit: optional(pipe(number(), minValue(1), maxValue(100, "Limit must be <= 100"))),
  sortBy: optional(picklist(["title", "status", "priority", "dueDate", "createdAt"] as const)),
  order: optional(picklist(["asc", "desc"] as const)),
  showDeleted: optional(boolean()),
});
