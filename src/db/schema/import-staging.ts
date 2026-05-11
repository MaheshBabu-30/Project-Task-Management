import { pgTable, uuid, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { importJobs } from "./import-jobs.js";

export const importStaging = pgTable(
  "import_staging",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").notNull().references(() => importJobs.id, { onDelete: "cascade" }),
    rowIndex: integer("row_index").notNull(),
    rowData: jsonb("row_data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("import_staging_job_id_idx").on(table.jobId),
  ]
);
