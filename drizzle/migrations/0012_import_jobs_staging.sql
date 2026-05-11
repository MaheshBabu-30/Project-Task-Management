-- Create enums
CREATE TYPE "import_type" AS ENUM ('tasks', 'project', 'users', 'organization');
CREATE TYPE "import_status" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- Create import_jobs table
CREATE TABLE "import_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "type" "import_type" NOT NULL,
  "status" "import_status" NOT NULL DEFAULT 'pending',
  "org_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "total_rows" integer NOT NULL DEFAULT 0,
  "processed_rows" integer NOT NULL DEFAULT 0,
  "failed_rows" integer NOT NULL DEFAULT 0,
  "result" text,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "completed_at" timestamp with time zone
);

-- Create import_staging table
CREATE TABLE "import_staging" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL REFERENCES "import_jobs"("id") ON DELETE CASCADE,
  "row_index" integer NOT NULL,
  "row_data" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now()
);

-- Indexes
CREATE INDEX "import_jobs_org_id_idx" ON "import_jobs"("org_id");
CREATE INDEX "import_jobs_created_by_idx" ON "import_jobs"("created_by");
CREATE INDEX "import_jobs_status_idx" ON "import_jobs"("status");
CREATE INDEX "import_staging_job_id_idx" ON "import_staging"("job_id");
