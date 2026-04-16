import { object, string, optional, number, minValue, maxValue, pipe, boolean, picklist, array, uuid, minLength, maxLength, nonEmpty } from "valibot";

export const createProjectSchema = object({
  title: pipe(string(), nonEmpty("Title is required"), minLength(1, "Title is required"), maxLength(200, "Title must be at most 200 characters")),
  description: optional(pipe(string(), nonEmpty("Description cannot be empty"), maxLength(2000, "Description too long"))),
  logoUrl: optional(pipe(string(), nonEmpty("Logo URL cannot be empty"), maxLength(500, "URL too long"))),
  assignedUserIds: optional(array(pipe(string(), uuid("Invalid user ID format")))),
});

export const updateProjectSchema = object({
  title: optional(pipe(string(), nonEmpty("Title cannot be empty"), minLength(1, "Title is required"), maxLength(200, "Title must be at most 200 characters"))),
  description: optional(pipe(string(), nonEmpty("Description cannot be empty"), maxLength(2000, "Description too long"))),
  logoUrl: optional(pipe(string(), nonEmpty("Logo URL cannot be empty"), maxLength(500, "URL too long"))),
  status: optional(picklist(["active", "on_hold"] as const, "Status must be active or on_hold")),
  assignedUserIds: optional(array(pipe(string(), uuid("Invalid user ID format")))),
});

export const projectQuerySchema = object({
  id: optional(pipe(string(), uuid())),
  orgId: optional(pipe(string(), uuid())),
  title: optional(pipe(string(), maxLength(200, "Title filter must be at most 200 characters"))),
  createdBy: optional(pipe(string(), uuid())),
  status: optional(picklist(["active", "on_hold", "completed"] as const)),
  page: optional(pipe(number(), minValue(1, "Page must be >= 1"), maxValue(500, "Page must be <= 500"))),
  limit: optional(pipe(number(), minValue(1, "Limit must be >= 1"), maxValue(100, "Limit must be <= 100"))),
  sortBy: optional(picklist(["title", "status", "createdAt"] as const)),
  order: optional(picklist(["asc", "desc"] as const)),
  showDeleted: optional(boolean()),
});
