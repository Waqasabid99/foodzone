import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { logger } from "@/lib/logger";
import { notifyPermission, usersWithPermission } from "@/server/services/notification.service";
import { monthsBetween, nextFiscalYearAfter, runwayStatus } from "@/server/accounting/fiscal-calendar";
import { missingPeriodError } from "@/server/accounting/posting-errors";
import { BLOCKED, releaseBlockedEvents } from "@/server/jobs/outbox";

/**
 * The fiscal calendar, and the guard that stops history moving.
 *
 * A closed period is the promise a set of books makes: these numbers were
 * reported, and they will not change. Everything that makes accounting worth
 * doing — a tax return, an audit, a comparison with last quarter — rests on
 * that promise, so the guard is not a convenience feature. It is the reason the
 * module exists.
 *
 * Three states, and the difference between the last two is who is being stopped:
 *
 *   OPEN    postings land normally
 *   CLOSED  the period is reported. Nothing posts into it. Finance can reopen
 *           it if something genuinely has to be corrected.
 *   LOCKED  the period is filed. Not even finance can reopen it here — that is
 *           a deliberate dead end, because by this point the numbers have left
 *           the building and a quiet change would make the filed copy a lie.
 *
 * A posting whose date falls in no period at all is refused rather than posted
 * without one. An entry with no period cannot be closed, cannot be reported on,
 * and will not appear in any statement — it would be silently lost.
 */

/** One type, so the dedupe and the bell icon agree about what this is. */
export const FISCAL_RUNWAY_NOTIFICATION = "finance.fiscal_year_runway";

/**
 * The grant that can open a year — the same one `POST /admin/fiscal-years`
 * checks, so the warning can only ever go to people who can act on it.
 */
const FISCAL_GRANT = "accounting_periods.close";

const YEAR_SELECT = {
  id: true,
  name: true,
  startDate: true,
  endDate: true,
  isClosed: true,
  closedAt: true,
  periods: {
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      status: true,
      closedAt: true,
      closedById: true,
      _count: { select: { entries: true } },
    },
    orderBy: { startDate: "asc" },
  },
};

/** Dates are stored as `@db.Date`; comparing them needs the time stripped. */
function asDate(value) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/*
 * Re-exported, not reimplemented. The calendar arithmetic lives in a module
 * with no imports so that `prisma/seed.js` — plain node, no path aliases, no
 * validated environment — can create the opening fiscal year from the same
 * definition this service uses. Two copies would drift, and the drift would
 * show up as a month that exists in the seed and not in the UI.
 */
export {
  monthsBetween,
  fiscalYearFor,
  fiscalYearName,
  fiscalYearStartMonth,
  nextFiscalYearAfter,
  runwayStatus,
  RUNWAY_THRESHOLDS,
} from "@/server/accounting/fiscal-calendar";

/**
 * Creates a fiscal year and its monthly periods in one go.
 *
 * Periods are generated rather than entered, because a year with a missing
 * month is a hole that only shows up when something tries to post into it, long
 * after whoever set it up has moved on.
 */
export async function createFiscalYear(data, actor = null) {
  const startDate = asDate(data.startDate);
  const endDate = asDate(data.endDate);

  if (endDate <= startDate) {
    throw ApiError.validation("A fiscal year has to end after it starts", {
      endDate: ["Must be after the start date"],
    });
  }

  // Overlapping years would make "which period does this date belong to"
  // ambiguous, and every posting after that point a coin toss.
  const overlapping = await prisma.fiscalYear.findFirst({
    where: { startDate: { lte: endDate }, endDate: { gte: startDate } },
    select: { id: true, name: true },
  });
  if (overlapping) {
    throw ApiError.conflict(`These dates overlap ${overlapping.name}`, { fiscalYearId: overlapping.id });
  }

  const months = monthsBetween(startDate, endDate);

  const year = await withTransaction(async (tx) => {
    return tx.fiscalYear.create({
      data: {
        name: data.name,
        startDate,
        endDate,
        periods: { create: months.map((month) => ({ ...month, status: "OPEN" })) },
      },
      select: YEAR_SELECT,
    });
  });

  /*
   * Release anything that was waiting for a period.
   *
   * Opening a year is the only action that can clear a blocked posting, so it
   * is the natural place to do it — the alternative is up to a day of silence
   * between fixing the calendar and the books catching up, during which the
   * ledger still looks wrong and nobody can tell whether the fix worked.
   *
   * Deliberately not scoped to the year just created: an event does not record
   * which date it was refused for, and releasing one that is still blocked
   * costs a single attempt before it parks again.
   */
  const released = await releaseBlockedEvents();

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "fiscal_year.create",
    entityType: "FiscalYear",
    entityId: year.id,
    changes: { name: year.name, periods: months.length, releasedPostings: released },
  });

  return year;
}

export async function listFiscalYears() {
  return prisma.fiscalYear.findMany({ select: YEAR_SELECT, orderBy: { startDate: "desc" } });
}

export async function getFiscalYear(id) {
  const year = await prisma.fiscalYear.findUnique({ where: { id }, select: YEAR_SELECT });
  if (!year) throw ApiError.notFound("Fiscal year not found");
  return year;
}

/**
 * The period a date belongs to.
 *
 * Returns null rather than throwing so callers can decide: a report asking
 * "which period was this" tolerates none, a posting does not.
 */
export async function periodForDate(date, tx = prisma) {
  const day = asDate(date);

  return tx.accountingPeriod.findFirst({
    where: { startDate: { lte: day }, endDate: { gte: day } },
    select: { id: true, name: true, status: true, fiscalYearId: true },
  });
}

/**
 * The gate every posting passes through.
 *
 * Refuses with the period's name in the message, because "period closed" sends
 * whoever is reading it hunting, and "September 2026 is closed" does not.
 */
export async function assertPostable(date, tx = prisma) {
  const period = await periodForDate(date, tx);

  /*
   * Thrown from one place, carrying a reason code. The outbox parks an event
   * that fails for *this* reason instead of spending its retry budget on a
   * fault that only a human opening a fiscal year can clear — see
   * `accounting/posting-errors.js`.
   */
  if (!period) throw missingPeriodError(date);

  if (period.status === "CLOSED") {
    throw ApiError.conflict(`${period.name} is closed, so nothing can be posted into it`, {
      periodId: period.id,
      status: period.status,
      hint: "Reopen the period, or post the correction into the current one",
    });
  }

  if (period.status === "LOCKED") {
    throw ApiError.conflict(`${period.name} is locked and cannot be reopened`, {
      periodId: period.id,
      status: period.status,
      hint: "Post the correction into an open period instead",
    });
  }

  return period;
}

/**
 * Whether the books can still be posted into, and for how long.
 *
 * One read, used by three callers that must not disagree: the banner on the
 * dashboard, the notice the daily job sends, and the year the form offers to
 * open next.
 *
 * `blockedPostings` is the number of events already waiting for a period. It
 * is the difference between a reminder and a bill of damages — "your year ends
 * in three weeks" is easy to put off, "14 postings are waiting and none of
 * them are in the ledger" is not.
 */
export async function fiscalRunway({ now = new Date() } = {}) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const [period, latest, blockedPostings] = await Promise.all([
    prisma.accountingPeriod.findFirst({
      where: { startDate: { lte: today }, endDate: { gte: today } },
      select: {
        id: true,
        name: true,
        status: true,
        fiscalYear: { select: { id: true, name: true, endDate: true, isClosed: true } },
      },
    }),
    prisma.fiscalYear.findFirst({ orderBy: { endDate: "desc" }, select: { endDate: true } }),
    prisma.outboxEvent.count({ where: { status: BLOCKED } }),
  ]);

  /*
   * Measured against the latest year on file, not the one covering today.
   *
   * They are usually the same year. When next year has already been opened
   * they are not, and the runway is however far the calendar reaches — warning
   * about a year that ends in a fortnight when its successor is already there
   * is how a warning teaches people to ignore it.
   */
  const reach = period ? (latest?.endDate ?? period.fiscalYear.endDate) : null;
  const status = runwayStatus({ yearEndDate: reach, now });

  return {
    ...status,
    period: period ? { id: period.id, name: period.name, status: period.status } : null,
    fiscalYear: period ? period.fiscalYear : null,
    calendarEndsAt: reach ?? null,
    blockedPostings,
    // What to open next, so the warning and the form agree about the answer.
    suggestion: nextFiscalYearAfter(latest?.endDate ?? null, { now }),
  };
}

/**
 * The daily warning, sent once per step rather than every morning.
 *
 * Nothing here opens a year. A year's shape is a business decision — a short
 * transition year, a changed year end — and an automatically created one is
 * worse than none, because periods that have been posted into cannot be
 * deleted and an overlapping year then blocks the correct one. So this warns
 * the people who hold the grant to open it, and leaves the decision with them.
 *
 * Deduplicated on the threshold, not the day: a notice every morning for two
 * months trains people to dismiss it, and the escalation (60, 30, 7) is what
 * carries the urgency instead. A *lapsed* calendar is the exception and does
 * repeat daily — by then the books have stopped and a once-only notice that
 * somebody missed is how a quarter goes unposted.
 */
export async function warnAboutFiscalRunway({ now = new Date() } = {}) {
  const runway = await fiscalRunway({ now });

  /*
   * Who would be told, counted every cycle rather than only when something is
   * sent.
   *
   * A fan-out that reaches nobody is the quietest way for a warning system to
   * fail: everything reports success, the notification count is zero because
   * there was nobody to notify, and the first anyone hears of it is a year
   * that lapsed. So the audience is reported whether or not there is anything
   * to say, and an empty audience is logged as the configuration problem it
   * is.
   */
  const audience = (await usersWithPermission(FISCAL_GRANT)).length;
  if (!audience) {
    logger.error("nobody holds the grant to open a fiscal year", { permission: FISCAL_GRANT });
  }

  if (runway.state === "OK" && !runway.blockedPostings) {
    return { warned: 0, audience, state: runway.state, daysLeft: runway.daysLeft };
  }

  const lapsed = runway.state === "LAPSED";
  const waitingOnly = runway.state === "OK";
  const yearId = runway.fiscalYear?.id ?? "none";

  // Lapsed repeats daily, so the key carries the date; an expiry warning
  // carries its threshold and is therefore sent once per step.
  const key = lapsed
    ? `lapsed:${now.toISOString().slice(0, 10)}`
    : waitingOnly
      ? // Postings parked for a date the calendar does not cover, while today
        // is covered. Keyed by how many are waiting, so the count growing is
        // worth another notice and a steady count is not.
        `waiting:${runway.blockedPostings}`
      : `expiring:${yearId}:${runway.threshold}`;

  const already = await prisma.notification.findFirst({
    where: { type: FISCAL_RUNWAY_NOTIFICATION, data: { path: ["key"], equals: key } },
    select: { id: true },
  });
  if (already) return { warned: 0, audience, state: runway.state, daysLeft: runway.daysLeft, deduped: true };

  const waiting = runway.blockedPostings
    ? ` ${runway.blockedPostings} posting${runway.blockedPostings === 1 ? " is" : "s are"} already waiting and not in the ledger.`
    : "";

  const plural = runway.blockedPostings === 1 ? "posting is" : "postings are";
  const title = lapsed
    ? "The books have no open period for today"
    : waitingOnly
      ? `${runway.blockedPostings} ${plural} waiting for an accounting period`
      : `The financial year ends in ${runway.daysLeft} day${runway.daysLeft === 1 ? "" : "s"}`;

  const body = lapsed
    ? `Nothing can be posted to the ledger until a fiscal year covering today exists.${waiting} Open ${runway.suggestion.name} on the periods page.`
    : waitingOnly
      ? `${runway.blockedPostings} ${plural} dated outside every period on the calendar, so ${runway.blockedPostings === 1 ? "it is" : "they are"} being held rather than lost. Open the year covering those dates and they post themselves.`
      : `${runway.fiscalYear?.name ?? "The current year"} ends on ${new Date(runway.calendarEndsAt).toISOString().slice(0, 10)}. Open ${runway.suggestion.name} before then, or postings dated after it will have nowhere to go.`;

  const { created } = await notifyPermission({
    // The grant the create endpoint itself checks, so this cannot be sent to
    // people who are not allowed to act on it.
    permissionKey: FISCAL_GRANT,
    type: FISCAL_RUNWAY_NOTIFICATION,
    title,
    body,
    data: { key, state: runway.state, daysLeft: runway.daysLeft, suggestion: runway.suggestion },
    referenceType: "FiscalYear",
    referenceId: runway.fiscalYear?.id ?? null,
  });

  if (created) logger.warn("fiscal calendar is running out", { state: runway.state, daysLeft: runway.daysLeft, notified: created });

  return { warned: created, audience, state: runway.state, daysLeft: runway.daysLeft };
}

async function loadPeriod(id) {
  const period = await prisma.accountingPeriod.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      status: true,
      startDate: true,
      endDate: true,
      fiscalYearId: true,
      fiscalYear: { select: { id: true, name: true, isClosed: true } },
    },
  });
  if (!period) throw ApiError.notFound("Accounting period not found");
  return period;
}

/**
 * Closes a period.
 *
 * Refuses while a draft entry still sits in it. A draft is somebody's unfinished
 * work; closing around it either strands it for ever or invites it to be posted
 * into a closed period later. Either way the period's numbers are not final,
 * which is the one thing closing is supposed to mean.
 */
export async function closePeriod(id, actor) {
  const period = await loadPeriod(id);

  if (period.status !== "OPEN") {
    throw ApiError.conflict(`${period.name} is already ${period.status.toLowerCase()}`, { status: period.status });
  }

  const drafts = await prisma.journalEntry.count({ where: { periodId: id, status: "DRAFT" } });
  if (drafts > 0) {
    throw ApiError.conflict(`${period.name} still has ${drafts} unposted draft entr${drafts === 1 ? "y" : "ies"}`, {
      drafts,
      hint: "Post or delete them before closing",
    });
  }

  // An earlier period left open behind a closed one makes the sequence
  // meaningless: figures could still change underneath a period already
  // reported as final.
  const earlierOpen = await prisma.accountingPeriod.findFirst({
    where: { startDate: { lt: period.startDate }, status: "OPEN" },
    select: { id: true, name: true },
  });
  if (earlierOpen) {
    throw ApiError.conflict(`${earlierOpen.name} is still open, and it comes first`, {
      periodId: earlierOpen.id,
      hint: "Close periods in order",
    });
  }

  const closed = await prisma.accountingPeriod.update({
    where: { id },
    data: { status: "CLOSED", closedAt: new Date(), closedById: actor?.userId ?? null },
    select: { id: true, name: true, status: true, closedAt: true, closedById: true },
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "accounting_period.close",
    entityType: "AccountingPeriod",
    entityId: id,
    changes: { name: period.name, from: "OPEN", to: "CLOSED" },
  });

  return closed;
}

/** Reopens a closed period. Locked ones are a deliberate dead end. */
export async function reopenPeriod(id, { reason = null, actor }) {
  const period = await loadPeriod(id);

  if (period.status === "OPEN") {
    throw ApiError.conflict(`${period.name} is already open`);
  }

  if (period.status === "LOCKED") {
    throw ApiError.conflict(`${period.name} is locked. Locked periods cannot be reopened.`, {
      hint: "Post the correction into an open period instead",
    });
  }

  const reopened = await prisma.accountingPeriod.update({
    where: { id },
    data: { status: "OPEN", closedAt: null, closedById: null },
    select: { id: true, name: true, status: true },
  });

  // Reopening a reported period is exactly the event an auditor comes looking
  // for, so it is recorded loudly and with a reason.
  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "accounting_period.reopen",
    entityType: "AccountingPeriod",
    entityId: id,
    changes: { name: period.name, from: "CLOSED", to: "OPEN", reason },
  });

  return reopened;
}

/** Locks a period for good. One-way on purpose. */
export async function lockPeriod(id, actor) {
  const period = await loadPeriod(id);

  if (period.status === "LOCKED") return period;
  if (period.status !== "CLOSED") {
    throw ApiError.conflict("Close the period before locking it", { status: period.status });
  }

  const locked = await prisma.accountingPeriod.update({
    where: { id },
    data: { status: "LOCKED" },
    select: { id: true, name: true, status: true },
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "accounting_period.lock",
    entityType: "AccountingPeriod",
    entityId: id,
    changes: { name: period.name, from: "CLOSED", to: "LOCKED" },
  });

  return locked;
}

export async function listPeriods({ fiscalYearId, status } = {}) {
  return prisma.accountingPeriod.findMany({
    where: { ...(fiscalYearId ? { fiscalYearId } : {}), ...(status ? { status } : {}) },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      status: true,
      closedAt: true,
      fiscalYear: { select: { id: true, name: true } },
      _count: { select: { entries: true } },
    },
    orderBy: { startDate: "desc" },
  });
}
