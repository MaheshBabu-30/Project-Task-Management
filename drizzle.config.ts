import { defineConfig } from "drizzle-kit";
import "dotenv/config";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

export default defineConfig({
  schema: "./src/db/schema/*.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL as string,
    ssl: {
      rejectUnauthorized: false
    }
  },
  tablesFilter: ["users", "sessions", "otps", "organizations", "org_members", "projects", "project_members", "tasks", "task_assignees", "comments", "comment_mentions", "attachments", "notifications", "audit_logs", "import_jobs", "import_staging"]
});
