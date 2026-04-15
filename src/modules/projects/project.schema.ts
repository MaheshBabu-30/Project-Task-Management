import { object, string, optional, number, minValue, maxValue, pipe, boolean, picklist, array, uuid, minLength, maxLength } from "valibot";

export const createProjectSchema = object({
  title: pipe(string(), minLength(1, "Title is required"), maxLength(200, "Title must be at most 200 characters")),
  description: optional(pipe(string(), maxLength(2000, "Description too long"))),
  logoUrl: optional(pipe(string(), maxLength(500, "URL too long"))),
  assignedUserIds: optional(array(pipe(string(), uuid()))),
});

export const updateProjectSchema = object({
  title: optional(pipe(string(), minLength(1, "Title is required"), maxLength(200, "Title must be at most 200 characters"))),
  description: optional(pipe(string(), maxLength(2000, "Description too long"))),
  logoUrl: optional(pipe(string(), maxLength(500, "URL too long"))),
  // "completed" removed — project auto-completes when all tasks are done
  status: optional(picklist(["active", "on_hold"] as const)),
  assignedUserIds: optional(array(pipe(string(), uuid()))),
});

export const projectQuerySchema = object({
  id: optional(pipe(string(), uuid())),
  orgId: optional(pipe(string(), uuid())),
  title: optional(string()),
  createdBy: optional(pipe(string(), uuid())),
  status: optional(picklist(["active", "on_hold", "completed"] as const)),
  page: optional(pipe(number(), minValue(1, "Page must be >= 1"))),
  limit: optional(pipe(number(), minValue(1, "Limit must be >= 1"), maxValue(100, "Limit must be <= 100"))),
  sortBy: optional(picklist(["title", "status", "createdAt"] as const)),
  order: optional(picklist(["asc", "desc"] as const)),
  showDeleted: optional(boolean()),
});
