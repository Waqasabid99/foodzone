import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { drainOutbox, pruneOutbox, releaseBlockedEvents } from "@/server/jobs/outbox";
import { registerJobHandlers } from "@/server/jobs/handlers";
import { clearExpiredAvailability } from "@/server/services/menu.service";
import { pruneQrScans } from "@/server/services/qr.service";
import { pruneExpiredCarts } from "@/server/services/cart.service";
import { pruneTrackPoints } from "@/server/services/driver.service";
import { flagExpiredBatches } from "@/server/services/stock.service";
import { alertLowStock } from "@/server/services/inventory-item.service";
import { warnAboutFiscalRunway } from "@/server/services/fiscal.service";
import { creditDueEarnings } from "@/server/services/creator-earning.service";
import { expireAttributions } from "@/server/services/creator-attribution.service";
import { expireCredit } from "@/server/services/creator-wallet.service";
import { liftLapsedSuspensions } from "@/server/services/creator.service";
import { pruneViewEvents, rollUpDay } from "@/server/services/creator-engagement.service";
import { sweepOrphanedUploads } from "@/server/services/media.service";
import { deriveRange } from "@/server/services/attendance.service";
import { addDays, zonedDateOf } from "@/server/attendance/shift";
import { prisma } from "@/lib/prisma";


/**
 * Background work, arranged to run the same way in two very different places:
 *
 *   * a long-lived Node server (Docker/VPS) — an interval loop started from
 *     `instrumentation.js` when WORKER_IN_PROCESS=true
 *   * serverless (Vercel) — a cron hitting POST /api/internal/jobs/outbox
 *
 * Both call `runOutboxCycle`, and both are safe to run at once: claiming uses
 * SKIP LOCKED, so an overlapping cron and loop simply split the batch.
 */
export async function runOutboxCycle(options) {
  registerJobHandlers();
  return drainOutbox(options);
}

export async function runMaintenanceCycle() {
  registerJobHandlers();

  const [outbox, availabilityRestored, qrScansPruned, cartsPruned, trackPointsPruned, batchesExpired] =
    await Promise.all([
    pruneOutbox(),
    // Timed 86s whose deadline has passed. Reads already treat an expired
    // deadline as available, so this only keeps the stored column honest for
    // anything reading it directly — reports, a POS's local cache.
    clearExpiredAvailability(),
    // QrScan grows with every customer who looks at a menu. The headline
    // counter lives on QrCode and never expires, so only the per-day detail
    // ages out.
    pruneQrScans(),
    // Abandoned baskets. The 7-day TTL is also the creator-attribution window,
    // so a cart outliving it would keep an attribution alive past its expiry.
    pruneExpiredCarts(),
    // Delivery breadcrumbs are evidence for disputes, not history to keep
    // forever — a row every 30 seconds per active driver adds up quickly.
    pruneTrackPoints(),
    // Passed-expiry batches stop being handed out by FIFO. Deliberately not
    // written off: expired stock still physically exists and has to be counted
    // and disposed of by a person, and silently removing it would destroy the
    // evidence of how much is being wasted.
    flagExpiredBatches(),
  ]);

  /*
   * Objects uploaded but never confirmed.
   *
   * Not inside the `Promise.all` above: this one talks to a storage provider
   * rather than the database, and a provider that is slow or rate-limiting
   * would hold the whole cycle open. It is also the only step here that
   * deletes something a database row does not describe, which is reason enough
   * for it to run on its own and fail on its own — a bucket that cannot be
   * listed must not stop the ledger housekeeping that follows.
   */
  let uploadsSwept;
  try {
    uploadsSwept = await sweepOrphanedUploads();
  } catch (error) {
    logger.error("the orphaned upload sweep failed", { error: error.message });
    uploadsSwept = { failedToRun: true, reason: error.message };
  }

  /*
   * Stock at or below its reorder level, told to whoever can raise an order.
   *
   * After the prunes rather than inside the race above because it sends
   * notifications: a fan-out belongs on its own line where a failure is
   * legible, not buried among the housekeeping it would take down with it.
   */
  let lowStock;
  try {
    lowStock = await alertLowStock();
  } catch (error) {
    logger.error("the low-stock alert failed", { error: error.message });
    lowStock = { failedToRun: true, reason: error.message };
  }

  /*
   * These two are ordered, not raced.
   *
   * The warning counts the postings that are waiting, and the release empties
   * that queue — so running them together let the release win and the warning
   * report a backlog of zero, every day, for a backlog that was really there.
   * Warn about what is waiting first, then release it.
   */
  const fiscalWarning = await warnAboutFiscalRunway();
  // Postings that were waiting for an accounting period. Creating a fiscal
  // year releases them itself; this is the safety net for a year that arrived
  // another way — the seed, a restored backup, somebody editing the calendar
  // directly. A release that was not needed costs one drain, and the event
  // parks again without spending any of its retry budget.
  const postingsReleased = await releaseBlockedEvents();

  return {
    ...outbox,
    availabilityRestored,
    qrScansPruned,
    cartsPruned,
    trackPointsPruned,
    batchesExpired,
    uploadsSwept,
    lowStock,
    postingsReleased,
    fiscalRunway: {
      state: fiscalWarning.state,
      daysLeft: fiscalWarning.daysLeft,
      warned: fiscalWarning.warned,
      // Who could act on it. Zero means the warning has nowhere to go.
      audience: fiscalWarning.audience,
    },
  };
}

/**
 * The creator program's scheduled half.
 *
 * Split from maintenance because these move money: an earning crediting is a
 * balance a creator can spend, and burying it in a housekeeping job that also
 * prunes log rows makes it far too easy to disable by accident.
 */
export async function runCreatorCycle() {
  registerJobHandlers();

  const [credited, attributionsExpired, creditExpired, suspensionsLifted] = await Promise.all([
    // Earnings past their refund hold become spendable.
    creditDueEarnings(),
    // An attribution that outlived its window would credit a creator for a
    // purchase made a month after watching, which is not a sale it drove.
    expireAttributions(),
    expireCredit(),
    liftLapsedSuspensions(),
  ]);

  return { credited, attributionsExpired, creditExpired, suspensionsLifted };
}

/**
 * How many days back each nightly fold reaches.
 *
 * Three rather than one, because a worker that missed a night must not leave a
 * hole in somebody's pay — the extra reach heals a gap left by a deploy, an
 * outage, or a machine that was simply off.
 *
 * Re-folding a day recomputes it from the same punches and writes the same
 * answer, so the repetition is wasted work rather than a hazard. What makes it
 * safe is narrower than "nothing is rewritten": a day that has been paid is
 * locked and a day a human corrected is flagged, and derivation refuses both.
 * Everything else is simply derived again.
 */
const FOLD_DAYS = 3;

/**
 * Turns raw punches into the attendance days payroll is built from.
 *
 * Its own cycle rather than part of maintenance, for the reason the creator
 * cycle is: this decides what people are paid. An absence only becomes a row
 * when something derives the day — nothing is pushed when a person does not
 * turn up — so without this a day with no punch stays missing until somebody
 * happens to touch it, and a payslip is built from attendance that was never
 * worked out.
 *
 * Per branch, because "yesterday" is a different day in Karachi than it is in
 * Greenwich, and a shift is a wall clock in the branch's own zone.
 *
 * Yesterday rather than today: a day still in progress has punches yet to
 * arrive, and folding it would write a half-day that the next run has to
 * correct. Running repeatedly is safe because derivation refuses a locked day
 * (already paid) and one a human corrected by hand; any other day is
 * recomputed from the same punches and lands on the same answer.
 */
export async function runAttendanceCycle({ days = FOLD_DAYS, now = new Date() } = {}) {
  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true, name: true, timezone: true },
  });

  const branchResults = [];
  let derived = 0;
  let skipped = 0;

  for (const branch of branches) {
    // One branch's bad data must not stop the rest being folded — a payroll
    // run that silently skipped three outlets would be found at month end.
    try {
      const today = zonedDateOf(now, branch.timezone ?? "UTC");
      const to = addDays(today, -1);
      const from = addDays(to, -(Math.max(1, days) - 1));

      const result = await deriveRange({ branchId: branch.id, from, to, force: false });
      derived += result.derived;
      skipped += result.skipped;
      branchResults.push({
        branchId: branch.id,
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
        employees: result.employees,
        derived: result.derived,
        skipped: result.skipped,
        failed: result.failed.length,
      });
    } catch (error) {
      logger.error("attendance fold failed for a branch", { branchId: branch.id, error: error.message });
      branchResults.push({ branchId: branch.id, failedToRun: true, reason: error.message });
    }
  }

  return { branches: branches.length, derived, skipped, perBranch: branchResults };
}

/**
 * Folds yesterday's raw engagement into per-day rows and prunes old events.
 *
 * Yesterday rather than today, so the day being summarised is actually over —
 * rolling up a day in progress produces a number that changes every time you
 * look at it.
 */
export async function runCreatorRollup({ date = null, retentionDays = 90 } = {}) {
  const target = date ? new Date(date) : new Date(Date.now() - 86_400_000);

  const rolled = await rollUpDay({ date: target });
  const pruned = await pruneViewEvents({ retentionDays });

  return { ...rolled, pruned };
}

let timer = null;

/** Starts the in-process loop. No-op unless WORKER_IN_PROCESS is set. */
export function startInProcessWorker() {
  const config = env();
  if (!config.WORKER_IN_PROCESS) return { started: false, reason: "DISABLED" };
  if (timer) return { started: false, reason: "ALREADY_RUNNING" };

  registerJobHandlers();
  const intervalMs = config.WORKER_INTERVAL_SECONDS * 1000;
  let running = false;

  timer = setInterval(async () => {
    // Skip rather than queue up: a slow batch must not stack cycles on top of
    // each other.
    if (running) return;
    running = true;
    try {
      const result = await drainOutbox();
      if (result.claimed) logger.info("outbox cycle", result);
    } catch (error) {
      logger.error("outbox cycle failed", { error: error.message });
    } finally {
      running = false;
    }
  }, intervalMs);

  // Do not hold the process open on shutdown.
  timer.unref?.();
  logger.info("in-process outbox worker started", { intervalSeconds: config.WORKER_INTERVAL_SECONDS });

  return { started: true, intervalSeconds: config.WORKER_INTERVAL_SECONDS };
}

export function stopInProcessWorker() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
