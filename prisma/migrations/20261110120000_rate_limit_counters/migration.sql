-- A request counter shared across app instances.
--
-- The limiter's default store is an in-process map, which is correct for one
-- instance and costs nothing. Two instances behind a load balancer each allow
-- the full quota, so the login endpoint's cap of 20 silently becomes 40 — this
-- is what `RATE_LIMIT_STORE=postgres` points at instead.
--
-- `key` is the primary key because it is the only thing ever looked up, and
-- every operation is one `INSERT .. ON CONFLICT DO UPDATE .. RETURNING`:
-- read-then-write would let two instances both see "4 of 5" and both allow.

CREATE TABLE "RateLimitCounter" (
    -- "scope:identity" exactly as the limiter composes it — "auth:ip:1.2.3.4".
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitCounter_pkey" PRIMARY KEY ("key")
);

-- How the nightly prune finds what is finished. Nothing reads an expired row:
-- the upsert resets a counter whose window has passed in the same statement,
-- so a stale row is wasted space rather than a wrong answer.
CREATE INDEX "RateLimitCounter_resetAt_idx" ON "RateLimitCounter"("resetAt");
