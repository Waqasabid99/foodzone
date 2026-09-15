import { ApiError } from "@/lib/api/errors";
import { env } from "@/lib/env";
import { getClientIp } from "@/lib/api/request";

/**
 * Fixed-window rate limiting.
 *
 * The default store is an in-process Map, which means limits are PER SERVER
 * INSTANCE: two instances behind a load balancer each allow the full quota. For
 * a single deployment that is fine, and it is far better than nothing on the
 * login endpoint. Before scaling out, call `setRateLimitStore()` with a Redis
 * (or Upstash) backed implementation — everything else here stays the same.
 */

const memory = new Map();

const memoryStore = {
  async increment(key, windowMs) {
    const now = Date.now();
    const existing = memory.get(key);

    if (!existing || existing.resetAt <= now) {
      const entry = { count: 1, resetAt: now + windowMs };
      memory.set(key, entry);
      sweep(now);
      return entry;
    }

    existing.count += 1;
    return existing;
  },
  async reset(key) {
    memory.delete(key);
  },
};

let store = memoryStore;

export function setRateLimitStore(customStore) {
  store = customStore ?? memoryStore;
}

let lastSweep = 0;

/**
 * Drops expired entries opportunistically. A timer would keep the process
 * alive and leak in serverless; sweeping on write costs nothing measurable.
 */
function sweep(now) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, entry] of memory) {
    if (entry.resetAt <= now) memory.delete(key);
  }
}

/** Sensible defaults per endpoint class. Tune per route as needed. */
export const RateLimits = {
  /// Login, register, password reset: the brute-force targets. Keyed by IP for
  /// anonymous callers, so the cap has to tolerate a shared address — an office
  /// or a mobile carrier NAT is one IP for hundreds of people.
  auth: { limit: 20, windowMs: 15 * 60_000 },
  /// Token refresh. Every device refreshes every 15 minutes, so a handful of
  /// users behind one NAT would trip the `auth` cap within the hour. This is
  /// still bounded, just realistic.
  session: { limit: 120, windowMs: 15 * 60_000 },
  /// OTP and password-reset sends: strict, because each one costs money.
  otp: { limit: 5, windowMs: 15 * 60_000 },
  /// Ordinary reads.
  read: { limit: 300, windowMs: 60_000 },
  /// Anything that writes.
  write: { limit: 60, windowMs: 60_000 },
  /// Checkout and payment initiation.
  checkout: { limit: 20, windowMs: 60_000 },
  /// Media uploads (creator videos, receipts).
  upload: { limit: 10, windowMs: 60 * 60_000 },
  /// Public, unauthenticated endpoints such as the QR menu.
  public: { limit: 120, windowMs: 60_000 },
};

/**
 * Signed-in callers are limited per user, so one office sharing an IP is not
 * throttled as a single client; anonymous callers fall back to IP.
 */
export function defaultRateLimitKey({ request, principal, scope }) {
  const identity = principal ? `user:${principal.userId}` : `ip:${getClientIp(request)}`;
  return `${scope}:${identity}`;
}

export async function checkRateLimit(key, { limit, windowMs }) {
  if (env().RATE_LIMIT_DISABLED) {
    return { allowed: true, limit, remaining: limit, resetAt: Date.now() + windowMs };
  }

  const entry = await store.increment(key, windowMs);
  const remaining = Math.max(0, limit - entry.count);

  return {
    allowed: entry.count <= limit,
    limit,
    remaining,
    resetAt: entry.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000)),
  };
}

/**
 * Throws 429 with `Retry-After` when the quota is spent.
 *
 * The reading is attached to the error as well, because the 429 is the one
 * response where a client most needs to know when the window resets — and it
 * was the only response that used to go out without the `RateLimit-*` headers.
 */
export async function enforceRateLimit(key, options) {
  const result = await checkRateLimit(key, options);
  if (result.allowed) return result;

  const error = ApiError.rateLimited("Too many requests, please slow down", {
    retryAfterSeconds: result.retryAfterSeconds,
  });
  error.rateLimit = result;
  throw error;
}

/** Standard headers so clients can back off before they are rejected. */
export function rateLimitHeaders(result) {
  if (!result) return {};
  return {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000))),
  };
}

/** Clears a caller's counter — call after a successful login. */
export async function resetRateLimit(key) {
  await store.reset(key);
}
