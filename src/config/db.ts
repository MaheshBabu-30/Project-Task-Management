import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const caPath = path.resolve(__dirname, "../../ca.pem");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: fs.existsSync(caPath)
    ? { ca: fs.readFileSync(caPath).toString(), rejectUnauthorized: true }
    : { rejectUnauthorized: false }, // no CA cert — encrypt but skip cert verification (standard for hosted DBs)
});

export const db = drizzle(pool);
