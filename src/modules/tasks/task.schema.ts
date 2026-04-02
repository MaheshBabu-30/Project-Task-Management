import { object, string, optional, number, minValue, pipe } from "valibot";

export const createTaskSchema = object({
  title: string(),
  description: optional(string()),
  projectId: number(),
  assignedTo: number()
});

export const updateTaskSchema = object({
  title: optional(string()),
  description: optional(string()),
  projectId: optional(number()),
  assignedTo: optional(number()),
  status: optional(string())
});

export const taskQuerySchema = object({
  id: optional(string()),
  status: optional(string()),
  projectId: optional(string()),
  assignedTo: optional(string()),
  page: optional(pipe(number(), minValue(1))),
  limit: optional(pipe(number(), minValue(1))),
  sortBy: optional(string()),
  order: optional(string())
});
