import { object, string, optional, number, minValue, pipe, picklist } from "valibot";

// For searching/filtering users
export const userQuerySchema = object({
  id: optional(string()),
  name: optional(string()),
  email: optional(string()),
  role: optional(picklist(["superadmin", "admin", "developer"])),
  status: optional(picklist(["active", "inactive"])),
  orgId: optional(string()), // Superadmin can filter by orgId
  page: optional(pipe(number(), minValue(1, "Page must be >= 1"))),
  limit: optional(pipe(number(), minValue(1, "Limit must be >= 1"))),
  sortBy: optional(string()),
  order: optional(string())
});

// For updating a user's basic info
export const updateUserSchema = object({
  name: optional(string()),
  phone: optional(string()),
  avatarUrl: optional(string()),
});

// For an admin toggling a developer's status
export const toggleUserStatusSchema = object({
  status: picklist(["active", "inactive"]),
});
