process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import fs from "fs";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    ca: fs.readFileSync("./ca.pem").toString(),
  },
});

const db = drizzle(pool);

await migrate(db, {
  migrationsFolder: "./drizzle/migrations",
});

console.log("✅ Migrations applied successfully");
process.exit(0);
