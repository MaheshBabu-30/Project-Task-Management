import pg from "pg";
import "dotenv/config";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const client = await pool.connect();

const statements = [
  // ─── Enum ──────────────────────────────────────────────────────────────────
  `DO $$ BEGIN
    CREATE TYPE "public"."notification_type" AS ENUM(
      'task_assigned', 'task_overdue', 'task_completed', 'comment_added', 'member_removed'
    );
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  // ─── Tables ────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "attachments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "task_id" uuid NOT NULL,
    "uploaded_by" uuid,
    "s3_key" text NOT NULL,
    "file_name" varchar(255) NOT NULL,
    "mime_type" varchar(100),
    "file_size" integer,
    "created_at" timestamp with time zone DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "org_id" uuid,
    "actor_id" uuid,
    "action" varchar(100) NOT NULL,
    "entity_type" varchar(50) NOT NULL,
    "entity_id" uuid NOT NULL,
    "before" text,
    "after" text,
    "ip_address" varchar(45),
    "created_at" timestamp with time zone DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS "comments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "task_id" uuid NOT NULL,
    "author_id" uuid,
    "body" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    "deleted_at" timestamp with time zone
  )`,

  `CREATE TABLE IF NOT EXISTS "notifications" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "type" "notification_type" NOT NULL,
    "title" varchar(255) NOT NULL,
    "body" text,
    "entity_type" varchar(50),
    "entity_id" uuid,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now()
  )`,

  // ─── Columns ───────────────────────────────────────────────────────────────
  `ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone`,
  `ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "deleted_by" uuid`,
  `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "parent_task_id" uuid`,

  // ─── Foreign Keys ──────────────────────────────────────────────────────────
  `DO $$ BEGIN
    ALTER TABLE "attachments" ADD CONSTRAINT "attachments_task_id_tasks_id_fk"
      FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_users_id_fk"
      FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_organizations_id_fk"
      FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk"
      FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "comments" ADD CONSTRAINT "comments_task_id_tasks_id_fk"
      FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk"
      FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  `DO $$ BEGIN
    ALTER TABLE "organizations" ADD CONSTRAINT "organizations_deleted_by_users_id_fk"
      FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  // ─── Indexes ───────────────────────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS "attachments_task_id_idx" ON "attachments" ("task_id")`,
  `CREATE INDEX IF NOT EXISTS "attachments_uploaded_by_idx" ON "attachments" ("uploaded_by")`,
  `CREATE INDEX IF NOT EXISTS "audit_logs_org_id_idx" ON "audit_logs" ("org_id")`,
  `CREATE INDEX IF NOT EXISTS "audit_logs_actor_id_idx" ON "audit_logs" ("actor_id")`,
  `CREATE INDEX IF NOT EXISTS "audit_logs_entity_id_idx" ON "audit_logs" ("entity_id")`,
  `CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs" ("created_at")`,
  `CREATE INDEX IF NOT EXISTS "comments_task_id_idx" ON "comments" ("task_id")`,
  `CREATE INDEX IF NOT EXISTS "comments_author_id_idx" ON "comments" ("author_id")`,
  `CREATE INDEX IF NOT EXISTS "notifications_user_id_idx" ON "notifications" ("user_id")`,
  `CREATE INDEX IF NOT EXISTS "notifications_unread_idx" ON "notifications" ("user_id", "read_at")`,
  `CREATE INDEX IF NOT EXISTS "organizations_deleted_at_idx" ON "organizations" ("deleted_at")`,
  `CREATE INDEX IF NOT EXISTS "tasks_parent_task_id_idx" ON "tasks" ("parent_task_id")`,
  `CREATE INDEX IF NOT EXISTS "tasks_due_date_idx" ON "tasks" ("due_date")`,
];

try {
  await client.query("BEGIN");

  for (const stmt of statements) {
    const preview = stmt.trim().slice(0, 80).replace(/\n/g, " ");
    console.log(`Running: ${preview}...`);
    await client.query(stmt);
  }

  await client.query("COMMIT");
  console.log("\n✅ Migration applied successfully.");
} catch (err: any) {
  await client.query("ROLLBACK");
  console.error("\n❌ Migration failed. Rolled back.");
  console.error(err.message);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
