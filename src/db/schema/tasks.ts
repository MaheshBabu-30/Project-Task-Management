import { pgTable, uuid, varchar, text, timestamp, date, index, pgEnum, type AnyPgColumn } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { projects } from "./projects.js";

export const taskStatusEnum = pgEnum("task_status", [
  "to_do",
  "in_progress",
  "on_hold",
  "overdue",
  "completed",
]);

export const taskPriorityEnum = pgEnum("task_priority", ["low", "medium", "high", "urgent"]);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => tasks.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 300 }).notNull(),
    description: text("description"),
    status: taskStatusEnum("status").notNull().default("to_do"),
    priority: taskPriorityEnum("priority").notNull().default("medium"),
    dueDate: date("due_date"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("tasks_project_id_idx").on(table.projectId),
    index("tasks_parent_task_id_idx").on(table.parentTaskId),
    index("tasks_status_idx").on(table.status),
    index("tasks_priority_idx").on(table.priority),
    index("tasks_deleted_at_idx").on(table.deletedAt),
    index("tasks_due_date_idx").on(table.dueDate),
  ]
);
