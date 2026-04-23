import { pgTable, uuid, text, timestamp, index, type AnyPgColumn } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { tasks } from "./tasks.js";

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    parentCommentId: uuid("parent_comment_id").references((): AnyPgColumn => comments.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("comments_task_id_idx").on(table.taskId),
    index("comments_author_id_idx").on(table.authorId),
    index("comments_parent_comment_id_idx").on(table.parentCommentId),
  ]
);
