import { object, string, optional, number, minValue, maxValue, pipe, picklist, array, boolean, uuid, minLength, maxLength, regex, nonEmpty, check } from "valibot";

export const createTaskSchema = object({
  title: pipe(string(), nonEmpty("Title is required"), minLength(1, "Title is required"), maxLength(300, "Title must be at most 300 characters")),
  description: optional(pipe(string(), nonEmpty("Description cannot be empty"), maxLength(5000, "Description too long"))),
  priority: optional(picklist(["low", "medium", "high", "urgent"] as const, "Priority must be low, medium, high, or urgent")),
  dueDate: optional(pipe(string(), nonEmpty("Due date cannot be empty"), regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"), check((v) => !isNaN(Date.parse(v)), "Invalid date value"))),
  projectId: pipe(string(), nonEmpty("projectId is required"), uuid("Invalid project ID")),
  parentTaskId: optional(pipe(string(), nonEmpty("parentTaskId cannot be empty"), uuid("Invalid parent task ID"))),
  assignedUserIds: optional(array(pipe(string(), uuid("Invalid user ID format")))),
});

export const updateTaskSchema = object({
  title: optional(pipe(string(), nonEmpty("Title cannot be empty"), minLength(1, "Title is required"), maxLength(300, "Title must be at most 300 characters"))),
  description: optional(pipe(string(), nonEmpty("Description cannot be empty"), maxLength(5000, "Description too long"))),
  priority: optional(picklist(["low", "medium", "high", "urgent"] as const, "Priority must be low, medium, high, or urgent")),
  dueDate: optional(pipe(string(), nonEmpty("Due date cannot be empty"), regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"), check((v) => !isNaN(Date.parse(v)), "Invalid date value"))),
  assignedUserIds: optional(array(pipe(string(), uuid("Invalid user ID format")))),
  status: optional(picklist(["to_do", "in_progress", "on_hold", "completed"] as const, "Invalid status")),
  // projectId intentionally excluded — tasks cannot be moved between projects
});

// For PATCH /tasks/:id/status — developer + admin
export const updateTaskStatusSchema = object({
  status: picklist(["to_do", "in_progress", "on_hold", "completed"] as const, "Status must be to_do, in_progress, on_hold, or completed"),
});

export const taskQuerySchema = object({
  id: optional(pipe(string(), uuid())),
  orgId: optional(pipe(string(), uuid())),
  status: optional(picklist(["to_do", "in_progress", "on_hold", "overdue", "completed"] as const)),
  priority: optional(picklist(["low", "medium", "high", "urgent"] as const)),
  search: optional(pipe(string(), maxLength(200, "Search must be at most 200 characters"))),
  projectId: optional(pipe(string(), uuid())),
  parentTaskId: optional(pipe(string(), uuid())),
  assignedUserId: optional(pipe(string(), uuid())),
  page: optional(pipe(number(), minValue(1, "Page must be >= 1"), maxValue(500, "Page must be <= 500"))),
  limit: optional(pipe(number(), minValue(1), maxValue(100, "Limit must be <= 100"))),
  sortBy: optional(picklist(["title", "status", "priority", "dueDate", "createdAt"] as const)),
  order: optional(picklist(["asc", "desc"] as const)),
  showDeleted: optional(boolean()),
});
