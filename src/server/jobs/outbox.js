import { prisma } from "@/lib/prisma";
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

/** Exponential backoff with jitter, capped at an hour. */
function nextAttemptDelayMs(attempts) {
  const base = Math.min(2 ** attempts * 1000, 60 * 60 * 1000);
  return base + Math.floor(Math.random() * 1000);
}

async function claimBatch(limit) {
  const leaseUntil = new Date(Date.now() + LEASE_SECONDS * 1000);

  // One statement: select-and-lock, then mark claimed. Two statements would
  // race between them.
  return prisma.$queryRaw`
    WITH claimed AS (
      SELECT id
      FROM "OutboxEvent"
      WHERE status IN ('PENDING', 'PROCESSING')
        AND "availableAt" <= now()
      ORDER BY "availableAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "OutboxEvent" AS e
    SET status = 'PROCESSING', "availableAt" = ${leaseUntil}
    FROM claimed
    WHERE e.id = claimed.id
    RETURNING e.id, e."eventType", e.payload, e.attempts;
  `;
}

/** Runs one batch. Returns counts so a cron response can be inspected. */
export async function drainOutbox({ limit } = {}) {
  const config = env();
  const batchSize = limit ?? config.WORKER_BATCH_SIZE;

  const events = await claimBatch(batchSize);
  if (!events.length) return { claimed: 0, processed: 0, failed: 0, retried: 0 };

  let processed = 0;
  let failed = 0;
  let retried = 0;

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

  return { claimed: events.length, processed, failed, retried };
}

/** Queue health, for a status endpoint or an alert. */
export async function outboxStats() {
  const [pending, processing, failed, oldest] = await Promise.all([
    prisma.outboxEvent.count({ where: { status: "PENDING" } }),
    prisma.outboxEvent.count({ where: { status: "PROCESSING" } }),
    prisma.outboxEvent.count({ where: { status: "FAILED" } }),
    prisma.outboxEvent.findFirst({
      where: { status: "PENDING" },
      orderBy: { availableAt: "asc" },
      select: { availableAt: true },
    }),
  ]);

  return { pending, processing, failed, oldestPendingAt: oldest?.availableAt ?? null, handlers: registeredEventTypes() };
}

/** Clears out delivered events. Called by the maintenance cron. */
export async function pruneOutbox({ olderThanDays = 7 } = {}) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.outboxEvent.deleteMany({
    where: { status: "DONE", processedAt: { lt: cutoff } },
  });
  return { pruned: count };
}
