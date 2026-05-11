import { pgTable, uuid, varchar, text, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { organizations } from "./organizations.js";

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "set null" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: varchar("action", { length: 100 }).notNull(),
    entityType: varchar("entity_type", { length: 50 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    before: text("before"),
    after: text("after"),
    ipAddress: varchar("ip_address", { length: 45 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("audit_logs_org_id_idx").on(table.orgId),
    index("audit_logs_actor_id_idx").on(table.actorId),
    index("audit_logs_entity_id_idx").on(table.entityId),
    index("audit_logs_created_at_idx").on(table.createdAt),
    index("audit_logs_org_id_created_at_idx").on(table.orgId, table.createdAt),
  ]
);
