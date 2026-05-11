import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const caPath = path.resolve(__dirname, "../../ca.pem");

// Strip ?sslmode=... from the URL so that pg-connection-string cannot override
// our explicit ssl option with a stricter mode (e.g. verify-full).
function stripSslMode(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("sslmode");
    return parsed.toString();
  } catch {
    return url.replace(/([?&])sslmode=[^&]*/gi, "").replace(/[?&]$/, "");
  }
}

const connectionString = stripSslMode(process.env.DATABASE_URL ?? "");

const pool = new Pool({
  connectionString,
  max: 25,
  ssl: fs.existsSync(caPath)
    ? { ca: fs.readFileSync(caPath).toString(), rejectUnauthorized: true }
    : { rejectUnauthorized: false }, // no CA cert — encrypt but skip cert verification (standard for hosted DBs)
});

export const db = drizzle(pool);
