import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * A rate-limit counter that several app instances can share.
 *
 * The default store is an in-process map, which is right for one instance and
 * costs nothing. It is also silently wrong for two: each instance allows the
 * full quota, so the login endpoint's cap of 20 attempts becomes 40 — and
 * nothing anywhere reports that, which is the kind of failure that is only
 * discovered by being exploited.
 *
 * Postgres rather than Redis because it is already here. The whole operation
 * is one statement, so there is no new service to run, nothing extra to keep
 * up, and no second answer to "what do we do when it is down".
 *
 * ## Why one statement matters
 *
 * Read-then-write loses the race it exists to win. Two instances both read
 * "4 of 5", both decide there is room, and both allow — which under the
 * concurrency that produces a flood is not a rare interleaving but the normal
 * case. `INSERT .. ON CONFLICT DO UPDATE .. RETURNING` increments and reports
 * the new value atomically, and rolls the window over in the same statement so
 * an expired counter needs no separate reset.
 *
 * ## The local shed in front of it
 *
 * A rate limiter has to be cheap exactly when it is working hardest. Backed
 * only by Postgres, a login brute-force becomes a write storm on the same
 * database that is serving orders — the limiter amplifying the attack it
 * exists to absorb.
 *
 * So a refusal is remembered in this process. Once the shared store has
 * refused a key, every further request for it inside that same window is
 * refused locally, for free, without a round trip. The bound this gives is the
 * point: at most `limit` writes per key per window per instance, and then
 * nothing.
 *
 * It cannot produce a false refusal, which is why it is a cache of refusals
 * rather than a second counter. Nothing lands in it that the authoritative
 * store did not itself refuse, and each entry expires at the `resetAt` that
 * store returned. A local counter would have needed its window to agree with
 * the shared one, and two clocks disagreeing about when a minute started is
 * how a limiter starts refusing people who are within their quota.
 */

/** Keys the shared store has refused, and when each window ends. */
const refused = new Map();

let lastSweep = 0;

/**
 * Drops finished entries on write rather than on a timer.
 *
 * A timer holds the process open and leaks on serverless; sweeping as we go
 * costs nothing measurable and keeps the map proportional to the number of
 * keys currently being refused, not to every key ever refused.
 */
function sweep(now) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, resetAt] of refused) {
    if (resetAt <= now) refused.delete(key);
  }
}

export function postgresRateLimitStore() {
  return {
    async increment(key, windowMs) {
      const now = Date.now();
      sweep(now);

      /*
       * Already refused in this window: answer from memory. `count` is
       * reported as one past the limit rather than the true total, because the
       * only thing the caller does with it is compare it against the limit —
       * and the true total is precisely what we are declining to go and ask
       * for.
       */
      const held = refused.get(key);
      if (held && held > now) return { count: Number.MAX_SAFE_INTEGER, resetAt: held, shed: true };
      if (held) refused.delete(key);

      const resetAt = new Date(now + windowMs);

      try {
        /*
         * `now() AT TIME ZONE 'UTC'`, never bare `now()`.
         *
         * `resetAt` is `timestamp without time zone` holding a UTC instant,
         * which is how Prisma stores every date here. `now()` is a
         * `timestamptz`, so comparing the two makes Postgres cast the column
         * using the **session** time zone — and this installation runs its
         * database in the branch's zone, not UTC. At +05:00 that read every
         * stored window as five hours older than it was, so every window
         * looked expired, every counter reset to 1 on every request, and the
         * limiter counted to one forever while reporting success.
         *
         * Caught only because the test cluster deliberately does not run in
         * UTC. It would have passed every test on a UTC machine and silently
         * removed rate limiting in production.
         */
        const rows = await prisma.$queryRaw(Prisma.sql`
          INSERT INTO "RateLimitCounter" ("key", "count", "resetAt")
          VALUES (${key}, 1, ${resetAt})
          ON CONFLICT ("key") DO UPDATE SET
            -- A window that has already ended starts again at this request, in
            -- the same statement: a separate reset would be a second round
            -- trip and a race of its own.
            "count"   = CASE WHEN "RateLimitCounter"."resetAt" <= (now() AT TIME ZONE 'UTC')
                             THEN 1 ELSE "RateLimitCounter"."count" + 1 END,
            "resetAt" = CASE WHEN "RateLimitCounter"."resetAt" <= (now() AT TIME ZONE 'UTC')
                             THEN ${resetAt} ELSE "RateLimitCounter"."resetAt" END
          RETURNING "count", "resetAt"
        `);

        const row = rows?.[0];
        if (!row) return { count: 1, resetAt: resetAt.getTime() };

        return { count: Number(row.count), resetAt: new Date(row.resetAt).getTime() };
      } catch (error) {
        /*
         * Fails open, deliberately and narrowly.
         *
         * Every endpoint behind this limiter needs the database to answer at
         * all, so a database that cannot be reached is not a situation where
         * refusing traffic protects anything — it only replaces a useful error
         * with a misleading one. Logged at error level because a limiter that
         * has quietly stopped limiting is exactly the thing somebody needs to
         * be told about.
         */
        logger.error("the shared rate-limit store is unreachable; not limiting", {
          error: error.message,
        });
        return { count: 1, resetAt: resetAt.getTime(), degraded: true };
      }
    },

    async reset(key) {
      refused.delete(key);
      try {
        await prisma.rateLimitCounter.deleteMany({ where: { key } });
      } catch (error) {
        // A counter that could not be cleared expires on its own. Worth a line,
        // not worth failing the successful login that asked for it.
        logger.warn("could not clear a rate-limit counter", { error: error.message });
      }
    },

    /** Called by the limiter when the shared store refuses a key. */
    remember(key, resetAt) {
      refused.set(key, resetAt);
    },

    /** For the test suite and the health endpoint. */
    stats() {
      return { driver: "postgres", shedding: refused.size };
    },
  };
}

/**
 * Counters whose window ended long ago.
 *
 * Nothing reads an expired row — the upsert resets it in place — so this is
 * housekeeping rather than correctness. Left for a day rather than cleared the
 * moment a window ends, because a row that is about to be incremented again is
 * cheaper to keep than to delete and reinsert.
 */
export async function pruneRateLimitCounters({ olderThanHours = 24 } = {}) {
  const before = new Date(Date.now() - olderThanHours * 3_600_000);
  const { count } = await prisma.rateLimitCounter.deleteMany({ where: { resetAt: { lt: before } } });
  return { pruned: count };
}
