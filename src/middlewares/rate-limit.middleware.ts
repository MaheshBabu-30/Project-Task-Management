import type { MiddlewareHandler } from "hono";
import { TooManyRequestsException } from "../exceptions/index.js";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Cap the store to prevent OOM if IPs are randomized by an attacker
const MAX_STORE_SIZE = 50_000;

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
    // Prefer the actual socket IP — cannot be spoofed by the client.
    // X-Forwarded-For is client-controlled and must not be trusted for rate limiting.
    const socketIp = (c.env as { incoming?: { socket?: { remoteAddress?: string } } })
      ?.incoming?.socket?.remoteAddress;
    const ip = socketIp ?? c.req.header("x-real-ip") ?? "unknown";

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
