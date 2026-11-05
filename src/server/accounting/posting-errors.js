/**
 * Telling a configuration fault apart from a bad event.
 *
 * Postings run through the outbox, which retries a handful of times with
 * backoff and then gives up and marks an event FAILED. That is the right
 * answer for a malformed payload or a handler that will never work: retrying
 * for ever would only fill the log.
 *
 * It is the wrong answer for one specific refusal. A posting whose date falls
 * in no accounting period is not broken — it is early. Nobody has opened the
 * year yet. The event becomes valid, unchanged, the moment somebody does, and
 * the whole retry budget is spent in a few hours while a fiscal year that has
 * lapsed over a weekend takes days to notice.
 *
 * The cost of getting it wrong is not a delay, it is a hole in the books:
 * `postMissingEntries` can recover orders, payments, goods receipts and
 * production runs, but nothing recovers a wastage write-off, a refund, a cash
 * session or an expense that failed this way. Those days would simply never be
 * in the ledger.
 *
 * So the refusal is marked here, where both the thrower and the worker can see
 * it, rather than matched on its message. A message is prose — it gets
 * reworded, translated, or wrapped by a driver, and the day it does, a quiet
 * string comparison starts parking real bugs for ever instead of surfacing
 * them. A reason code is a contract.
 */

import { ApiError } from "@/lib/api";

export const NO_ACCOUNTING_PERIOD = "NO_ACCOUNTING_PERIOD";

/**
 * The refusal itself, so there is exactly one place it is constructed.
 *
 * Still a 400: an API caller asking to post into a date with no period has
 * genuinely made a request that cannot be served, and the hint says what to do
 * about it.
 */
export function missingPeriodError(date = null) {
  return ApiError.validation("That date is not in any accounting period", {
    entryDate: ["Create the fiscal year covering this date first"],
    reason: NO_ACCOUNTING_PERIOD,
    date: date ? new Date(date).toISOString().slice(0, 10) : null,
  });
}

/**
 * Narrow on purpose. Anything this returns true for stops being retried on the
 * normal schedule, so a predicate that is too generous turns a real bug into
 * an event that waits for ever and is never reported.
 */
export function isMissingAccountingPeriod(error) {
  return error?.details?.reason === NO_ACCOUNTING_PERIOD;
}
