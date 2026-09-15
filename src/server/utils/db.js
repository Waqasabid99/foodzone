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
