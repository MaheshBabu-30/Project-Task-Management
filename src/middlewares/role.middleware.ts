import type { Context, Next } from "hono";

export const roleMiddleware = (roles: string[] = []) => {
  return async (c: Context, next: Next) => {
    const user = c.get("user");

    if (!roles.includes(user.role)) {
      return c.json({ message: "Forbidden" }, 403);
    }

    return next();
  };
};
