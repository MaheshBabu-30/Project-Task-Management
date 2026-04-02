import { verifyToken } from "../utils/jwt.js";
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

  try {
    const payload = verifyToken(token);
    c.set("user", payload);
    await next();
  } catch {
    return c.json({ message: "Invalid or expired token" }, 401);
  }
};
