import type { MiddlewareHandler } from "hono";
import { TooManyRequestsException } from "../exceptions/index.js";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Cap the store to prevent OOM if IPs are randomized by an attacker
const MAX_STORE_SIZE = 50_000;

// Single shared cleanup — runs once per minute regardless of how many rateLimiter() instances exist
const _cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt <= now) store.delete(key);
  }
}, 60_000);
if (typeof _cleanup === "object" && "unref" in _cleanup) (_cleanup as NodeJS.Timeout).unref();

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
  return async (c, next) => {
    // Use the actual socket IP only — headers like X-Real-IP and X-Forwarded-For
    // are client-controlled and can be spoofed to bypass rate limiting.
    const ip =
      (c.env as { incoming?: { socket?: { remoteAddress?: string } } })
        ?.incoming?.socket?.remoteAddress ?? "unknown";

    const key = `${ip}:${c.req.path}`;
    const now = Date.now();

    const entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      // Drop the oldest entry if the store is at capacity to prevent OOM
      if (!entry && store.size >= MAX_STORE_SIZE) {
        const firstKey = store.keys().next().value;
        if (firstKey) store.delete(firstKey);
      }
      store.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count++;

    if (entry.count > max) {
      throw new TooManyRequestsException(message);
    }

    return next();
  };
};
