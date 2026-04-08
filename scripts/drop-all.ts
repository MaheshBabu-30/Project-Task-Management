process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import "dotenv/config";
import pg from "pg";
import fs from "fs";

const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    ca: fs.readFileSync("./ca.pem").toString(),
  },
});

await client.connect();

console.log("🗑️  Dropping all existing tables and enums...");

await client.query(`
  -- Drop tables in reverse dependency order
  DROP TABLE IF EXISTS task_assignees CASCADE;
  DROP TABLE IF EXISTS task_assignments CASCADE;
  DROP TABLE IF EXISTS tasks CASCADE;
  DROP TABLE IF EXISTS project_members CASCADE;
  DROP TABLE IF EXISTS projects CASCADE;
  DROP TABLE IF EXISTS org_members CASCADE;
  DROP TABLE IF EXISTS organizations CASCADE;
  DROP TABLE IF EXISTS sessions CASCADE;
  DROP TABLE IF EXISTS otps CASCADE;
  DROP TABLE IF EXISTS files CASCADE;
  DROP TABLE IF EXISTS users CASCADE;

  -- Drop old enums if any
  DROP TYPE IF EXISTS task_status CASCADE;
  DROP TYPE IF EXISTS task_priority CASCADE;
  DROP TYPE IF EXISTS project_status CASCADE;
  DROP TYPE IF EXISTS org_member_role CASCADE;
  DROP TYPE IF EXISTS user_status CASCADE;
  DROP TYPE IF EXISTS user_role CASCADE;

  -- Drop Drizzle migration tracking table to start fresh
  DROP TABLE IF EXISTS drizzle.__drizzle_migrations CASCADE;
  DROP SCHEMA IF EXISTS drizzle CASCADE;
`);

console.log("✅ Database cleaned successfully.");
await client.end();
process.exit(0);
