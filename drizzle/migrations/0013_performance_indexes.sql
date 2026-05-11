-- Partial index for updateProjectStatusIfComplete (runs on every task mutation)
CREATE INDEX IF NOT EXISTS "tasks_project_status_check_idx"
  ON "tasks" ("project_id")
  WHERE "deleted_at" IS NULL AND "parent_task_id" IS NULL;

-- Partial index for the hourly overdue cron job
CREATE INDEX IF NOT EXISTS "tasks_overdue_candidate_idx"
  ON "tasks" ("due_date")
  WHERE "deleted_at" IS NULL AND "status" NOT IN ('completed', 'overdue', 'on_hold');

-- Composite index for org-scoped audit log date-range queries
CREATE INDEX IF NOT EXISTS "audit_logs_org_id_created_at_idx"
  ON "audit_logs" ("org_id", "created_at" DESC);
