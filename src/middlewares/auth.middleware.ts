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

    // Status is embedded in the JWT payload at login/refresh time.
    // Deactivation takes effect at next token refresh (max ~1h delay).
    if (payload.status === "inactive") {
      return c.json({ message: "User account is deactivated. Access denied." }, 403);
    }

    c.set("user", payload);
    return next();
  } catch {
    return c.json({ message: "Invalid or expired token" }, 401);
  }
};
