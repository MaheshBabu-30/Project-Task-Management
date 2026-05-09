CREATE UNIQUE INDEX "organizations_name_unique" ON "organizations" ("name") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "projects_org_id_title_unique" ON "projects" ("org_id", "title") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_project_id_title_unique" ON "tasks" ("project_id", "title") WHERE "deleted_at" IS NULL;
