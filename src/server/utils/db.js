import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Transaction helper.
 *
 * Anything that touches money or stock spans several tables — an order writes
 * order rows, stock movements, a payment and a journal entry — and a partial
 * write there is a corrupted ledger, not a glitch. Wrap the whole unit.
 *
 * The default timeout is raised from Prisma's 5s because checkout does real
 * work (recipe explosion, stock deduction, numbering) under load.
 */
export function withTransaction(fn, { timeout = 15_000, maxWait = 5_000, isolationLevel } = {}) {
  return prisma.$transaction(fn, { timeout, maxWait, ...(isolationLevel ? { isolationLevel } : {}) });
}

/**
 * A transaction whose time budget is sized to the work inside it.
 *
 * Posting stock is **one round trip per line, several for a batch-tracked
 * one**, and the database is not local: against a hosted Postgres each line
 * costs tens of milliseconds of latency that no amount of query tuning
 * removes. A fixed 15-second budget therefore does not describe a limit on
 * the work — it describes a limit on *how many lines a document may have*,
 * which nothing in the system tells the user about.
 *
 * It fails the way that is hardest to diagnose, too: the document is small
 * enough in testing and fine in a seed, then a real opening stock count of a
 * hundred and forty lines expires halfway and rolls the lot back, with an
 * error about transaction timeouts rather than about anything the manager did.
 * A stock count of 200 lines is explicitly allowed by the schema, so it has to
 * be allowed by the clock as well.
 *
 * The allowance is 1.5s a line, measured rather than guessed: posting one line
 * is about seven sequential round trips (load the item, load the location,
 * read the level, re-average the cost across locations, write the cost, upsert
 * the level, write the movement) and a 33-line opening count took 40 seconds
 * against a hosted database. Co-located, the same work is an order of
 * magnitude quicker — the allowance is deliberately sized for the slow case,
 * because that is the one that fails.
 *
 * The budget is capped, because a transaction holding row locks for minutes is
 * its own problem: it occupies a pooled connection and blocks every other
 * writer touching those items. **That cap is a real limit, not a formality** —
 * at the slow end it lands somewhere around 150 lines, short of the 200 the
 * schema allows. Pushing past it wants `postMovement` batched into set-based
 * writes rather than a longer clock; until then a count that large should be
 * split across two documents.
 */
export function withBulkTransaction(fn, { lines = 1, perLineMs = 1_500, base = 15_000, max = 120_000, ...options } = {}) {
  const timeout = Math.min(base + Math.max(0, lines) * perLineMs, max);
  return withTransaction(fn, { ...options, timeout });
}

/**
 * Retries a transaction that failed on a serialization conflict or deadlock.
 * Both are expected under concurrency and are safe to replay — Postgres has
 * already rolled the attempt back.
 */
export async function withRetryingTransaction(fn, { attempts = 3, ...options } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await withTransaction(fn, options);
    } catch (error) {
      const retryable = ["P2034", "40001", "40P01"].includes(error?.code);
      if (!retryable || attempt === attempts) throw error;

      lastError = error;
      logger.warn("retrying transaction after conflict", { attempt, code: error.code });
      // Exponential backoff with jitter, so retries do not collide again.
      await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt + Math.random() * 25));
    }
  }

  throw lastError;
}
