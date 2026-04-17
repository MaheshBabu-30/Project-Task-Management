import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import fs from "fs";
import path from "path";
import "dotenv/config";

const { Pool } = pg;

const caPath = path.resolve("./ca.pem");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: fs.existsSync(caPath)
    ? { ca: fs.readFileSync(caPath).toString(), rejectUnauthorized: true }
    : { rejectUnauthorized: true },
});

export const db = drizzle(pool);
