import type { Next } from "hono";
import type { Context } from "hono";
import type { UserRole } from "../types/auth.types.js";
import type { AppEnv } from "../types/hono.types.js";
import { ForbiddenException } from "../exceptions/index.js";

export const roleMiddleware = (roles: UserRole[] = []) => {
  return async (c: Context<AppEnv>, next: Next): Promise<void> => {
    const user = c.get("user");

    if (!roles.includes(user.role)) {
      throw new ForbiddenException("You do not have permission to access this resource");
    }

    return next();
  };
};
