import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";

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

/** The calendar months between two dates, inclusive of both ends. */
export function monthsBetween(startDate, endDate) {
  const start = asDate(startDate);
  const end = asDate(endDate);
  const months = [];

  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));

  while (cursor <= end) {
    const monthStart = new Date(cursor);
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));

    months.push({
      // The first and last periods are clipped to the year, so a year that
      // starts mid-month gets a short first period rather than one that
      // reaches back before the year began.
      startDate: monthStart < start ? start : monthStart,
      endDate: monthEnd > end ? end : monthEnd,
      name: new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(monthStart),
    });

    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }

  return months;
}

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

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "fiscal_year.create",
    entityType: "FiscalYear",
    entityId: year.id,
    changes: { name: year.name, periods: months.length },
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

  if (!period) {
    throw ApiError.validation("That date is not in any accounting period", {
      entryDate: ["Create the fiscal year covering this date first"],
    });
  }

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
