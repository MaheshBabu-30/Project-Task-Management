import { defineConfig } from "drizzle-kit";
import "dotenv/config";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL as string,
    ssl: {
      rejectUnauthorized: false
    }
  },
  tablesFilter: ["users", "sessions", "otps", "organizations", "org_members", "projects", "project_members", "tasks", "task_assignees", "comments", "attachments", "notifications", "audit_logs"]
});
