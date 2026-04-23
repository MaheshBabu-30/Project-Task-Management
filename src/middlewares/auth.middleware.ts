import { verifyToken } from "../utils/jwt.js";
import { db } from "../config/db.js";
import { users } from "../db/schema/index.js";
import { and, eq, isNull } from "drizzle-orm";
import type { Next } from "hono";
import type { AppEnv } from "../types/hono.types.js";
import type { Context } from "hono";

// Short-lived cache to avoid a DB round-trip on every request.
// TTL of 30s means a deactivated user loses access within half a minute.
const USER_STATUS_TTL_MS = 30_000;
const statusCache = new Map<string, { status: "active" | "inactive"; expiresAt: number }>();

// Purge stale entries every 5 minutes to prevent unbounded memory growth.
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of statusCache) {
    if (value.expiresAt <= now) statusCache.delete(key);
  }
}, 5 * 60 * 1000).unref();

const getCachedStatus = async (userId: string): Promise<"active" | "inactive" | null> => {
  const now = Date.now();
  const cached = statusCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.status;

  const [row] = await db
    .select({ status: users.status })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)));

  if (!row) return null;
  statusCache.set(userId, { status: row.status, expiresAt: now + USER_STATUS_TTL_MS });
  return row.status;
};

export const authMiddleware = async (c: Context<AppEnv>, next: Next): Promise<Response | void> => {
  const authHeader = c.req.header("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ message: "Unauthorized" }, 401);
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return c.json({ message: "Unauthorized" }, 401);
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return c.json({ message: "Invalid or expired token" }, 401);
  }

  let status: "active" | "inactive" | null;
  try {
    status = await getCachedStatus(payload.userId);
  } catch {
    return c.json({ message: "Authentication service unavailable" }, 503);
  }

  if (!status || status === "inactive") {
    statusCache.delete(payload.userId);
    return c.json({ message: "User account is deactivated. Access denied." }, 403);
  }

  c.set("user", payload);
  return next();
};
