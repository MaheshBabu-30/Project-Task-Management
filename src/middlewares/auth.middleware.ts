import { verifyToken } from "../utils/jwt.js";
import type { Context, Next } from "hono";
import { db } from "../config/db.js";
import { users } from "../../drizzle/schema.js";
import { eq, and, isNull } from "drizzle-orm";

export const authMiddleware = async (c: Context, next: Next) => {
  const authHeader = c.req.header("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ message: "Unauthorized" }, 401);
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return c.json({ message: "Unauthorized" }, 401);
  }

  try {
    const payload = verifyToken(token);

    // 🔐 Verify user still exists, is active, and is not soft-deleted
    const [user] = await db
      .select({ status: users.status })
      .from(users)
      .where(and(eq(users.id, payload.userId), isNull(users.deletedAt)))
      .limit(1);

    if (!user) {
      return c.json({ message: "User not found" }, 401);
    }

    if (user.status === "inactive") {
      return c.json({ message: "User account is deactivated. Access denied." }, 403);
    }

    // Inject full payload (userId, role, orgId) into context
    c.set("user", payload);
    await next();
  } catch {
    return c.json({ message: "Invalid or expired token" }, 401);
  }
};
