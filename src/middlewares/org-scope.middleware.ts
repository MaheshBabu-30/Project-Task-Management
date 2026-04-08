import type { Context, Next } from "hono";
import { AppError } from "../utils/errors.js";

/**
 * Ensures a user only accesses resources within their assigned organization.
 * SUPERADMIN bypasses this check.
 */
export const orgScopeMiddleware = async (c: Context, next: Next) => {
  const user = c.get("user");

  if (!user) {
    throw new AppError("Unauthorized", 401);
  }

  // Superadmin has global access
  if (user.role === "superadmin") {
    return next();
  }

  // Admin and Developer must have an orgId
  if (!user.orgId) {
    throw new AppError("Access denied. No organization assigned.", 403);
  }

  await next();
};

/**
 * Validates that a resource's organization ID matches the user's organization ID.
 */
export const checkOrgMatch = (resourceOrgId: string, userOrgId: string) => {
  if (resourceOrgId !== userOrgId) {
    throw new AppError("Access denied to this resource. Organization mismatch.", 403);
  }
};
