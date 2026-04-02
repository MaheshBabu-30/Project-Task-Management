import { object, string, optional, number, minValue, pipe } from "valibot";

export const userQuerySchema = object({
  id: optional(string()),
  name: optional(string()),
  email: optional(string()),
  role: optional(string()),
  page: optional(pipe(number(), minValue(1, "Page must be >= 1"))),
  limit: optional(pipe(number(), minValue(1, "Limit must be >= 1"))),
  sortBy: optional(string()),
  order: optional(string())
});
