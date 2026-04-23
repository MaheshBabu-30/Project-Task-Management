import { pgTable, uuid, unique, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { comments } from "./comments.js";

export const commentMentions = pgTable(
  "comment_mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    unique("comment_mentions_unique").on(table.commentId, table.userId),
    index("comment_mentions_comment_id_idx").on(table.commentId),
    index("comment_mentions_user_id_idx").on(table.userId),
  ]
);
