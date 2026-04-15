process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import "dotenv/config";
import pg from "pg";
import fs from "fs";
import path from "path";

const { Pool } = pg;
const caPath = path.resolve("./ca.pem");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    ...(fs.existsSync(caPath) ? { ca: fs.readFileSync(caPath).toString() } : {}),
    rejectUnauthorized: false,
  },
});

const migrationsDir = path.resolve("./drizzle/migrations");
const client = await pool.connect();

try {
  // Ensure tracking table exists
  await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL UNIQUE,
      created_at BIGINT
    )
  `);

  // Get already-applied migrations
  const { rows } = await client.query<{ hash: string }>(`SELECT hash FROM drizzle.__drizzle_migrations`);
  const applied = new Set(rows.map((r) => r.hash));

  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`[skip] ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    console.log(`[apply] ${file}`);
    await client.query(sql);
    await client.query(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`, [file, Date.now()]);
    console.log(`[done] ${file}`);
  }

  console.log("✅ All migrations applied.");
} catch (err) {
  console.error("❌ Migration failed:", err);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
