import { pgTable, uuid, varchar, text, timestamp, index, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const notificationTypeEnum = pgEnum("notification_type", [
  "task_assigned",
  "task_due_soon",
  "task_overdue",
  "task_completed",
  "task_reopened",
  "comment_added",
  "comment_mentioned",
  "comment_replied",
  "member_added",
  "member_removed",
  "project_assigned",
]);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body"),
    entityType: varchar("entity_type", { length: 50 }),
    entityId: uuid("entity_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("notifications_user_id_idx").on(table.userId),
    index("notifications_unread_idx").on(table.userId, table.readAt),
  ]
);
