import { verifyToken } from "../utils/jwt.js";
import type { Context, Next } from "hono";
import { db } from "../config/db.js";
import { users } from "../../drizzle/schema.js";
import { eq } from "drizzle-orm";

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
    const payload = verifyToken(token) as { userId: number; role: string };

    // 🔐 Critical Security Check: Ensure user is still active in the database
    const [user] = await db
      .select({ isActive: users.isActive })
      .from(users)
      .where(eq(users.id, payload.userId))
      .limit(1);

    if (!user || !user.isActive) {
      return c.json({ message: "User account is deactivated. Access denied." }, 403);
    }

    c.set("user", payload);
    await next();
  } catch {
    return c.json({ message: "Invalid or expired token" }, 401);
  }
};
