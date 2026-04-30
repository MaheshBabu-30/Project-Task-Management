import { object, string, optional, nullish, pipe, picklist, array, minLength, maxLength, regex, nonEmpty, check, trim, email } from "valibot";
import type { InferOutput } from "valibot";
import { taskStatusEnum, taskPriorityEnum, projectStatusEnum } from "../../db/schema/index.js";

const SETTABLE_STATUSES = taskStatusEnum.enumValues.filter((s) => s !== "overdue") as [
  "to_do",
  "in_progress",
  "on_hold",
  "completed",
];

const importSubtaskSchema = object({
  title: pipe(string(), trim(), nonEmpty("Title is required"), maxLength(300, "Title must be at most 300 characters")),
  description: nullish(pipe(string(), trim(), nonEmpty("Description cannot be empty"), maxLength(5000, "Description too long"))),
  priority: optional(picklist(taskPriorityEnum.enumValues, "Priority must be low, medium, high, or urgent")),
  status: optional(picklist(SETTABLE_STATUSES, "Invalid status")),
  dueDate: nullish(pipe(
    string(), trim(), nonEmpty("Due date cannot be empty"),
    regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
    check((v) => !isNaN(Date.parse(v)), "Invalid date value"),
  )),
  assigneeEmails: optional(array(pipe(string(), trim(), email("Invalid email format")))),
});

const importTaskItemSchema = object({
  title: pipe(string(), trim(), nonEmpty("Title is required"), maxLength(300, "Title must be at most 300 characters")),
  description: nullish(pipe(string(), trim(), nonEmpty("Description cannot be empty"), maxLength(5000, "Description too long"))),
  priority: optional(picklist(taskPriorityEnum.enumValues, "Priority must be low, medium, high, or urgent")),
  status: optional(picklist(SETTABLE_STATUSES, "Invalid status")),
  dueDate: nullish(pipe(
    string(), trim(), nonEmpty("Due date cannot be empty"),
    regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
    check((v) => !isNaN(Date.parse(v)), "Invalid date value"),
  )),
  assigneeEmails: optional(array(pipe(string(), trim(), email("Invalid email format")))),
  subtasks: optional(array(importSubtaskSchema)),
});

export const importTasksBodySchema = object({
  tasks: pipe(
    array(importTaskItemSchema),
    minLength(1, "At least one task is required"),
    maxLength(500, "Cannot import more than 500 tasks at once"),
  ),
});

export const importProjectBodySchema = object({
  project: object({
    title: pipe(string(), trim(), nonEmpty("Title is required"), maxLength(200, "Title must be at most 200 characters")),
    description: nullish(pipe(string(), trim(), nonEmpty("Description cannot be empty"), maxLength(5000, "Description too long"))),
    status: optional(picklist(projectStatusEnum.enumValues, "Status must be active, on_hold, or completed")),
  }),
  tasks: optional(pipe(
    array(importTaskItemSchema),
    maxLength(500, "Cannot import more than 500 tasks at once"),
  )),
});

export type ImportTasksBody = InferOutput<typeof importTasksBodySchema>;
export type ImportProjectBody = InferOutput<typeof importProjectBodySchema>;
