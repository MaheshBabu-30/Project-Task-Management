import type { MiddlewareHandler } from "hono";
import { AppError } from "../exceptions/AppError.js";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

export interface RateLimitOptions {
  /** Time window in milliseconds */
  windowMs: number;
  /** Max number of requests per window per IP */
  max: number;
  message?: string;
}

/**
 * Simple in-memory rate limiter middleware.
 * Suitable for single-instance deployments; replace with Redis-backed store for multi-instance.
 */
export const rateLimiter = ({
  windowMs,
  max,
  message = "Too many requests. Please try again later.",
}: RateLimitOptions): MiddlewareHandler => {
  // Clean up expired entries on the same cadence as the window
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (entry.resetAt <= now) store.delete(key);
    }
  }, windowMs);

  // Allow Node to exit even if the interval is active
  if (typeof cleanup === "object" && "unref" in cleanup) {
    (cleanup as NodeJS.Timeout).unref();
  }

  return async (c, next) => {
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "unknown";

    const key = `${ip}:${c.req.path}`;
    const now = Date.now();

    const entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count++;

    if (entry.count > max) {
      throw new AppError(message, 429);
    }

    return next();
  };
};
