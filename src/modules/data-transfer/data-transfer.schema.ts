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

const importProjectItemSchema = object({
  title: pipe(string(), trim(), nonEmpty("Title is required"), maxLength(200, "Title must be at most 200 characters")),
  description: nullish(pipe(string(), trim(), nonEmpty("Description cannot be empty"), maxLength(5000, "Description too long"))),
  status: optional(picklist(projectStatusEnum.enumValues, "Status must be active, on_hold, or completed")),
  tasks: optional(pipe(
    array(importTaskItemSchema),
    maxLength(500, "Cannot import more than 500 tasks per project"),
  )),
});

// ─── Task Import ──────────────────────────────────────────────────────────────

export const importTasksBodySchema = object({
  tasks: pipe(
    array(importTaskItemSchema),
    minLength(1, "At least one task is required"),
    maxLength(500, "Cannot import more than 500 tasks at once"),
  ),
});

// ─── Project Import ───────────────────────────────────────────────────────────

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

// ─── Organization Import ──────────────────────────────────────────────────────

export const importOrgBodySchema = object({
  org: object({
    name: pipe(string(), trim(), nonEmpty("Name is required"), maxLength(200, "Name must be at most 200 characters")),
    slug: pipe(
      string(), trim(), nonEmpty("Slug is required"), maxLength(100, "Slug must be at most 100 characters"),
      regex(/^[a-z0-9-]+$/, "Slug can only contain lowercase letters, numbers, and hyphens"),
    ),
    description: nullish(pipe(string(), trim(), nonEmpty("Description cannot be empty"), maxLength(5000, "Description too long"))),
  }),
  projects: optional(pipe(
    array(importProjectItemSchema),
    maxLength(50, "Cannot import more than 50 projects at once"),
  )),
});

// ─── User Import ──────────────────────────────────────────────────────────────

export const importUsersBodySchema = object({
  users: pipe(
    array(object({
      name: pipe(string(), trim(), nonEmpty("Name is required"), maxLength(150, "Name must be at most 150 characters")),
      email: pipe(string(), trim(), email("Invalid email format")),
    })),
    minLength(1, "At least one user is required"),
    maxLength(100, "Cannot import more than 100 users at once"),
  ),
});

export type ImportTasksBody = InferOutput<typeof importTasksBodySchema>;
export type ImportProjectBody = InferOutput<typeof importProjectBodySchema>;
export type ImportOrgBody = InferOutput<typeof importOrgBodySchema>;
export type ImportUsersBody = InferOutput<typeof importUsersBodySchema>;
