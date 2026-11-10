import { ApiError } from "@/lib/api/errors";
import { env } from "@/lib/env";
import { getClientIp } from "@/lib/api/request";

/**
 * Fixed-window rate limiting.
 *
 * Two stores, chosen by `RATE_LIMIT_STORE`:
 *
 *   * **`memory`** (the default) — an in-process Map. Limits are per instance,
 *     which is correct for one long-lived server and costs nothing.
 *   * **`postgres`** — counters shared across instances, incremented in one
 *     atomic statement. See `rate-limit-store.js` for why that is one
 *     statement and why a refusal is then cached in this process.
 *
 * The default stays in memory rather than following the deployment, because
 * the wrong one here fails in opposite directions. Defaulting to `postgres`
 * would put a database write on the hot path of every endpoint of every
 * deployment, including the ones that never need it — and would make a unit
 * test that calls `enforceRateLimit` reach for a database. Defaulting to
 * `memory` on a multi-instance deployment doubles a quota silently, which is
 * worse but is also a deliberate scaling step somebody is taking on purpose.
 * So the one that costs nothing is the default and the one that costs a round
 * trip is asked for.
 *
 * `setRateLimitStore()` overrides both, for a test or an implementation that is
 * not here yet.
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
  stats() {
    return { driver: "memory", keys: memory.size };
  },
};

let store = null;
let injected = false;

export function setRateLimitStore(customStore) {
  store = customStore ?? memoryStore;
  injected = true;
}

/**
 * The store this deployment asked for, built once.
 *
 * Resolved lazily rather than at import, so the memory path never loads Prisma
 * — `rate-limit.js` is pulled in by every route through `@/lib/api`, and a
 * database client imported there for a deployment that does not use it is a
 * cost paid by everybody for nobody.
 */
async function activeStore() {
  if (store) return store;

  if (env().RATE_LIMIT_STORE === "postgres") {
    const { postgresRateLimitStore } = await import("@/lib/api/rate-limit-store");
    store = postgresRateLimitStore();
  } else {
    store = memoryStore;
  }

  return store;
}

/** Which store is in use, for the health endpoint and the test suite. */
export async function rateLimitDriver() {
  const active = await activeStore();
  return active.stats?.() ?? { driver: injected ? "custom" : "memory" };
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

  const active = await activeStore();
  const entry = await active.increment(key, windowMs);
  const remaining = Math.max(0, limit - entry.count);
  const allowed = entry.count <= limit;

  /*
   * Tell the store it refused this key, so the rest of the window is answered
   * from memory instead of from the database. Only on the transition — a store
   * that already shed this request has nothing to learn — and only where the
   * store keeps such a cache at all.
   */
  if (!allowed && !entry.shed) active.remember?.(key, entry.resetAt);

  return {
    allowed,
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
  const active = await activeStore();
  await active.reset(key);
}
