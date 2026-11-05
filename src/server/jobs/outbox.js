import { prisma } from "@/lib/prisma";
import { isMissingAccountingPeriod } from "@/server/accounting/posting-errors";
import { Prisma } from "@/generated/prisma";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Transactional outbox.
 *
 * A side effect written outside the transaction that caused it is a side effect
 * that can be lost: the order commits, the process dies, nobody is ever
 * notified. Enqueuing into the same transaction makes the event as durable as
 * the change itself, and a worker delivers it afterwards with retries.
 *
 * Claiming uses `FOR UPDATE SKIP LOCKED`, so several workers — or several
 * serverless invocations of the cron endpoint — can drain the queue at once
 * without ever handing the same row to two of them.
 *
 * `availableAt` doubles as a lease. A claimed row is pushed forward by
 * LEASE_SECONDS; if the worker crashes mid-handler, the lease lapses and the
 * row becomes claimable again instead of being stuck in PROCESSING forever.
 */
const LEASE_SECONDS = 300;

const handlers = new Map();

export function registerHandler(eventType, handler) {
  handlers.set(eventType, handler);
}

export function registeredEventTypes() {
  return [...handlers.keys()].sort();
}

/** Enqueue inside the transaction that produced the event. */
export async function enqueue({ eventType, payload, availableAt = new Date(), db = prisma }) {
  return db.outboxEvent.create({
    data: { eventType, payload, availableAt, status: "PENDING" },
    select: { id: true },
  });
}

/**
 * Waiting for configuration, not failed.
 *
 * A fifth status rather than a flag, because the claim query selects PENDING
 * and PROCESSING: a blocked event is simply not a candidate, which is both the
 * behaviour wanted and cheaper than a date far in the future that every cycle
 * still has to read past.
 */
export const BLOCKED = "BLOCKED";

/**
 * Puts blocked events back in the queue.
 *
 * Called when a fiscal year is created — the one action that can clear the
 * block — and from the daily maintenance cycle as a safety net, for a year
 * that arrived some other way. Releasing an event that is still blocked costs
 * one wasted attempt and it goes straight back, so a sweep that is too eager
 * is harmless; one that never runs is not.
 */
export async function releaseBlockedEvents() {
  const { count } = await prisma.outboxEvent.updateMany({
    where: { status: BLOCKED },
    data: { status: "PENDING", availableAt: new Date() },
  });
  if (count) logger.info("released outbox events that were waiting for an accounting period", { count });
  return count;
}

/** Exponential backoff with jitter, capped at an hour. */
function nextAttemptDelayMs(attempts) {
  const base = Math.min(2 ** attempts * 1000, 60 * 60 * 1000);
  return base + Math.floor(Math.random() * 1000);
}

async function claimBatch(limit) {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + LEASE_SECONDS * 1000);

  /*
   * One statement: select-and-lock, then mark claimed. Two statements would
   * race between them.
   *
   * The due check is against a bound timestamp and **not** Postgres's `now()`.
   * `availableAt` is `timestamp without time zone` holding UTC, which is what
   * Prisma writes; `now()` is a `timestamptz`, and comparing the two makes
   * Postgres render `now()` in the *session's* time zone. On a server set to
   * Asia/Karachi that reads five hours ahead of the stored values, so every
   * scheduled event fires up to five hours early and — worse — every lease
   * looks expired the moment it is taken, which lets two workers run the same
   * event at once.
   *
   * It is invisible on Neon and in CI because both run UTC, where the bug is
   * exactly a no-op. A self-hosted Postgres, which takes the machine's zone,
   * is where it bites. Binding the timestamp makes the statement read the same
   * on every server, and keeps the due check and the lease on one clock.
   */
  return prisma.$queryRaw(Prisma.sql`
    WITH claimed AS (
      SELECT id
      FROM "OutboxEvent"
      WHERE status IN ('PENDING', 'PROCESSING')
        AND "availableAt" <= ${now}
      ORDER BY "availableAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "OutboxEvent" AS e
    SET status = 'PROCESSING', "availableAt" = ${leaseUntil}
    FROM claimed
    WHERE e.id = claimed.id
    RETURNING e.id, e."eventType", e.payload, e.attempts;
  `);
}

/** Runs one batch. Returns counts so a cron response can be inspected. */
export async function drainOutbox({ limit } = {}) {
  const config = env();
  const batchSize = limit ?? config.WORKER_BATCH_SIZE;

  const events = await claimBatch(batchSize);
  if (!events.length) return { claimed: 0, processed: 0, failed: 0, retried: 0, blocked: 0 };

  let processed = 0;
  let failed = 0;
  let retried = 0;
  let blocked = 0;

  for (const event of events) {
    const handler = handlers.get(event.eventType);

    if (!handler) {
      // An unknown type is a deployment mismatch, not a transient fault:
      // retrying forever would just fill the log.
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: "FAILED", lastError: `No handler registered for "${event.eventType}"` },
      });
      failed += 1;
      logger.error("outbox event has no handler", { eventType: event.eventType, id: event.id });
      continue;
    }

    try {
      await handler(event.payload, event);
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: "DONE", processedAt: new Date(), attempts: { increment: 1 }, lastError: null },
      });
      processed += 1;
    } catch (error) {
      /*
       * Waiting for a fiscal year, not broken.
       *
       * Parked rather than retried: `attempts` is left alone so the budget is
       * not spent on a fault no amount of retrying can clear, and the status
       * takes it out of the claim query entirely so it is not re-read every
       * cycle. Opening the year releases it (`fiscal.service`), and the daily
       * maintenance cycle sweeps for any that were released another way — by
       * the seed, or by somebody editing the calendar directly.
       *
       * It stays visible: `blocked` is reported separately from `failed`, and
       * `lastError` says what it is waiting for.
       */
      if (isMissingAccountingPeriod(error)) {
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: { status: BLOCKED, lastError: String(error?.message ?? error).slice(0, 500) },
        });
        blocked += 1;
        logger.warn("outbox event is waiting for an accounting period", {
          id: event.id,
          eventType: event.eventType,
          error: error?.message,
        });
        continue;
      }

      const attempts = event.attempts + 1;
      const exhausted = attempts >= config.OUTBOX_MAX_ATTEMPTS;

      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: exhausted ? "FAILED" : "PENDING",
          attempts,
          lastError: String(error?.message ?? error).slice(0, 500),
          availableAt: exhausted ? new Date() : new Date(Date.now() + nextAttemptDelayMs(attempts)),
        },
      });

      if (exhausted) {
        failed += 1;
        logger.error("outbox event failed permanently", {
          id: event.id,
          eventType: event.eventType,
          attempts,
          error: error?.message,
        });
      } else {
        retried += 1;
        logger.warn("outbox event failed, will retry", {
          id: event.id,
          eventType: event.eventType,
          attempts,
          error: error?.message,
        });
      }
    }
  }

  return { claimed: events.length, processed, failed, retried, blocked };
}

/**
 * Queue health, for a status endpoint or an alert.
 *
 * `topFailure` is the reason the most events gave up for. Without it an alert
 * can only say that background work failed, which leaves whoever reads it
 * opening a database to find out what — and the reason is usually one
 * sentence that names the fix outright ("That date is not in any accounting
 * period" means nobody has opened one).
 */
export async function outboxStats() {
  const [pending, processing, failed, blocked, oldest, reasons] = await Promise.all([
    prisma.outboxEvent.count({ where: { status: "PENDING" } }),
    prisma.outboxEvent.count({ where: { status: "PROCESSING" } }),
    prisma.outboxEvent.count({ where: { status: "FAILED" } }),
    // Separate from `failed` on purpose: this number means "somebody has to
    // open a fiscal year", not "something is broken", and the two want
    // different reactions.
    prisma.outboxEvent.count({ where: { status: BLOCKED } }),
    prisma.outboxEvent.findFirst({
      where: { status: "PENDING" },
      orderBy: { availableAt: "asc" },
      select: { availableAt: true },
    }),
    prisma.outboxEvent.groupBy({
      by: ["lastError"],
      where: { status: "FAILED", lastError: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { lastError: "desc" } },
      take: 1,
    }),
  ]);

  return {
    pending,
    processing,
    failed,
    blocked,
    oldestPendingAt: oldest?.availableAt ?? null,
    topFailure: reasons[0] ? { reason: reasons[0].lastError, count: reasons[0]._count._all } : null,
    handlers: registeredEventTypes(),
  };
}

/** Clears out delivered events. Called by the maintenance cron. */
export async function pruneOutbox({ olderThanDays = 7 } = {}) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.outboxEvent.deleteMany({
    where: { status: "DONE", processedAt: { lt: cutoff } },
  });
  return { pruned: count };
}
