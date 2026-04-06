import { object, string, optional, number, minValue, pipe, boolean } from "valibot";

export const createProjectSchema = object({
  name: string(),
  description: optional(string())
});

export const projectQuerySchema = object({
  id: optional(string()),
  name: optional(string()),
  createdBy: optional(string()),
  page: optional(pipe(number(), minValue(1, "Page must be >= 1"))),
  limit: optional(pipe(number(), minValue(1, "Limit must be >= 1"))),
  sortBy: optional(string()),
  order: optional(string()),
  showDeleted: optional(boolean())
});
