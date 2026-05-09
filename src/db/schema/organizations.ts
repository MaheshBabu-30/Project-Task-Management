import { pgTable, uuid, varchar, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { isNull } from "drizzle-orm";
import { users } from "./users.js";

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 200 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull().unique(),
    description: text("description"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [
    index("organizations_slug_idx").on(table.slug),
    index("organizations_owner_id_idx").on(table.ownerId),
    index("organizations_deleted_at_idx").on(table.deletedAt),
    uniqueIndex("organizations_name_unique").on(table.name).where(isNull(table.deletedAt)),
  ]
);
