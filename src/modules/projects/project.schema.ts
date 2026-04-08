import { object, string, optional, number, minValue, pipe, boolean, picklist, array } from "valibot";

export const createProjectSchema = object({
  title: string("Project title is required"),
  description: optional(string()),
  logoUrl: optional(string()),
  assignedUserIds: optional(array(string())), // Developers to assign during creation
});

export const updateProjectSchema = object({
  title: optional(string()),
  description: optional(string()),
  logoUrl: optional(string()),
  status: optional(picklist(["active", "on_hold", "completed"])),
  assignedUserIds: optional(array(string())), // For bulk updating members
});

export const projectQuerySchema = object({
  id: optional(string()),
  title: optional(string()),
  createdBy: optional(string()),
  status: optional(picklist(["active", "on_hold", "completed"])),
  page: optional(pipe(number(), minValue(1, "Page must be >= 1"))),
  limit: optional(pipe(number(), minValue(1, "Limit must be >= 1"))),
  sortBy: optional(string()),
  order: optional(string()),
  showDeleted: optional(boolean())
});
