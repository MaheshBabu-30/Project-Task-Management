import { object, string, optional, number, minValue, maxValue, pipe, boolean, picklist, array, uuid, minLength, maxLength, nonEmpty, trim } from "valibot";
import { projectStatusEnum } from "../../../drizzle/schema.js";

// Settable statuses — "completed" is system-set only (auto when all tasks done)
const SETTABLE_PROJECT_STATUSES = projectStatusEnum.enumValues.filter((s) => s !== "completed") as ["active", "on_hold"];

export const createProjectSchema = object({
  title: pipe(string(), trim(), nonEmpty("Title is required"), minLength(1, "Title is required"), maxLength(200, "Title must be at most 200 characters")),
  description: optional(pipe(string(), trim(), nonEmpty("Description cannot be empty"), maxLength(2000, "Description too long"))),
  logoUrl: optional(pipe(string(), trim(), nonEmpty("Logo URL cannot be empty"), maxLength(500, "URL too long"))),
  assignedUserIds: optional(array(pipe(string(), uuid("Invalid user ID format")))),
});

export const updateProjectSchema = object({
  title: optional(pipe(string(), trim(), nonEmpty("Title cannot be empty"), minLength(1, "Title is required"), maxLength(200, "Title must be at most 200 characters"))),
  description: optional(pipe(string(), trim(), nonEmpty("Description cannot be empty"), maxLength(2000, "Description too long"))),
  logoUrl: optional(pipe(string(), trim(), nonEmpty("Logo URL cannot be empty"), maxLength(500, "URL too long"))),
  status: optional(picklist(SETTABLE_PROJECT_STATUSES, "Status must be active or on_hold")),
  assignedUserIds: optional(array(pipe(string(), uuid("Invalid user ID format")))),
});

export const projectQuerySchema = object({
  id: optional(pipe(string(), uuid())),
  orgId: optional(pipe(string(), uuid())),
  title: optional(pipe(string(), maxLength(200, "Title filter must be at most 200 characters"))),
  createdBy: optional(pipe(string(), uuid())),
  status: optional(picklist(projectStatusEnum.enumValues, "Invalid status")),
  page: optional(pipe(number(), minValue(1, "Page must be >= 1"), maxValue(500, "Page must be <= 500"))),
  limit: optional(pipe(number(), minValue(1, "Limit must be >= 1"), maxValue(100, "Limit must be <= 100"))),
  sortBy: optional(picklist(["title", "status", "createdAt"] as const)),
  order: optional(picklist(["asc", "desc"] as const)),
  showDeleted: optional(boolean()),
});
