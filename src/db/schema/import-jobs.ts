import { pgTable, uuid, text, timestamp, integer, pgEnum, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { organizations } from "./organizations.js";
import { projects } from "./projects.js";

export const importTypeEnum = pgEnum("import_type", ["tasks", "project", "users", "organization"]);
export const importStatusEnum = pgEnum("import_status", ["pending", "processing", "completed", "failed"]);

export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: importTypeEnum("type").notNull(),
    status: importStatusEnum("status").notNull().default("pending"),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    totalRows: integer("total_rows").notNull().default(0),
    processedRows: integer("processed_rows").notNull().default(0),
    failedRows: integer("failed_rows").notNull().default(0),
    result: text("result"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("import_jobs_org_id_idx").on(table.orgId),
    index("import_jobs_created_by_idx").on(table.createdBy),
    index("import_jobs_status_idx").on(table.status),
  ]
);
