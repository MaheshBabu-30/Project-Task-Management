import { verifyToken } from "../utils/jwt.js";
import { db } from "../config/db.js";
import { users } from "../../drizzle/schema.js";
import { and, eq, isNull } from "drizzle-orm";
import type { Context, Next } from "hono";

export const authMiddleware = async (c: Context, next: Next) => {
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

  // Always verify status against the DB — JWT payload can be stale for up to
  // the token TTL, meaning a deactivated/deleted user would retain access.
  let user: { status: "active" | "inactive" } | undefined;
  try {
    const [row] = await db
      .select({ status: users.status })
      .from(users)
      .where(and(eq(users.id, payload.userId), isNull(users.deletedAt)));
    user = row;
  } catch {
    return c.json({ message: "Authentication service unavailable" }, 503);
  }

  if (!user || user.status === "inactive") {
    return c.json({ message: "User account is deactivated. Access denied." }, 403);
  }

  c.set("user", payload);
  return next();
};
