import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { branchScope, can } from "@/lib/api/permissions";
import { branchFilter } from "@/server/access/scope";
import { scopedBranches } from "@/server/content/branch-scope";

/**
 * What the Finance screens need besides the records themselves: the counts on
 * the tabs, the pickers, and the few running totals worth putting at the top
 * of a page.
 *
 * Every figure here is cut to the viewer's branches. That matters more in
 * finance than anywhere else: a count badge is data. "47 payments" on a tab
 * tells a manager at one outlet how busy the others were, even if the list
 * below it is correctly filtered — so the badge is filtered too, and the two
 * always agree.
 *
 * The company-wide tables — the chart of accounts, tax groups, periods — are
 * deliberately not filtered, because they are not branch data. That is
 * explained where each one is used.
 */

export { scopedBranches };

export async function actionableBranches(principal, permissionKey) {
  const branches = await scopedBranches(principal, permissionKey);
  return branches.filter((branch) => branch.isActive && can(principal, permissionKey, { branchId: branch.id }));
}

const counted = (rows) => Object.fromEntries(rows.map((row) => [row.status, row._count._all]));

// --- counts for the tabs ----------------------------------------------------

export async function paymentCounts(principal, { branchId = null } = {}) {
  const filter = branchFilter(branchScope(principal, "payments.read"));
  return counted(
    await prisma.payment.groupBy({
      by: ["status"],
      where: { ...(filter ? { AND: [{ branchId: filter }] } : {}), ...(branchId ? { branchId } : {}) },
      _count: { _all: true },
    }),
  );
}

export async function refundCounts(principal, { branchId = null } = {}) {
  const filter = branchFilter(branchScope(principal, "refunds.read"));
  return counted(
    await prisma.refund.groupBy({
      by: ["status"],
      where: {
        ...(filter ? { AND: [{ payment: { branchId: filter } }] } : {}),
        ...(branchId ? { payment: { branchId } } : {}),
      },
      _count: { _all: true },
    }),
  );
}

export async function expenseCounts(principal, { branchId = null } = {}) {
  const filter = branchFilter(branchScope(principal, "expenses.read"));
  return counted(
    await prisma.expense.groupBy({
      by: ["status"],
      where: { ...(filter ? { AND: [{ branchId: filter }] } : {}), ...(branchId ? { branchId } : {}) },
      _count: { _all: true },
    }),
  );
}

export async function sessionCounts(principal, { branchId = null } = {}) {
  const filter = branchFilter(branchScope(principal, "cash_registers.read"));
  return counted(
    await prisma.cashRegisterSession.groupBy({
      by: ["status"],
      where: { ...(filter ? { AND: [{ branchId: filter }] } : {}), ...(branchId ? { branchId } : {}) },
      _count: { _all: true },
    }),
  );
}

export async function journalCounts(principal, { branchId = null } = {}) {
  const filter = branchFilter(branchScope(principal, "journal_entries.read"));
  return counted(
    await prisma.journalEntry.groupBy({
      by: ["status"],
      where: {
        ...(filter ? { AND: [{ OR: [{ branchId: filter }, { branchId: null }] }] } : {}),
        ...(branchId ? { branchId } : {}),
      },
      _count: { _all: true },
    }),
  );
}

// --- pickers ----------------------------------------------------------------

export async function expenseCategoryOptions({ includeInactive = false } = {}) {
  return prisma.expenseCategory.findMany({
    where: includeInactive ? {} : { isActive: true },
    select: { id: true, name: true, isActive: true, accountId: true },
    orderBy: { name: "asc" },
    take: 500,
  });
}

/**
 * Accounts money can be paid out of.
 *
 * Narrowed to the ones that hold money rather than offering the whole chart:
 * "paid from — Sales income" is not a mistake anybody should be able to make
 * in a dropdown, and the ledger has no way to express it sensibly afterwards.
 */
export async function paymentSourceAccounts() {
  return prisma.account.findMany({
    where: { isActive: true, type: "ASSET", subType: { in: ["Cash", "Bank"] } },
    select: { id: true, code: true, name: true, subType: true, branchId: true },
    orderBy: { code: "asc" },
    take: 200,
  });
}

/**
 * Accounts a wage deduction can be credited to.
 *
 * Narrowed the same way as the payment sources, and for the same reason: what
 * is withheld from pay is either owed to somebody — a tax authority, a fund —
 * or an advance the employee already has, coming back. Both are liabilities or
 * receivables, and "provident fund — Food sales" is not a mistake worth
 * offering. Parents are left out: posting to a heading rather than the account
 * under it makes every report that rolls up double-count.
 */
export async function deductionAccounts() {
  const rows = await prisma.account.findMany({
    where: {
      isActive: true,
      OR: [{ type: "LIABILITY" }, { type: "ASSET", subType: "Receivable" }],
    },
    select: { id: true, code: true, name: true, parentId: true },
    orderBy: { code: "asc" },
    take: 200,
  });

  const parentIds = new Set(rows.map((row) => row.parentId).filter(Boolean));
  return rows.filter((row) => !parentIds.has(row.id)).map(({ parentId, ...row }) => row);
}

/** Every account a journal line may point at. */
export async function accountOptions({ includeInactive = false } = {}) {
  return prisma.account.findMany({
    where: includeInactive ? {} : { isActive: true },
    select: { id: true, code: true, name: true, type: true, normalBalance: true, branchId: true, parentId: true, isSystem: true, isActive: true },
    orderBy: { code: "asc" },
    take: 1000,
  });
}

export async function taxGroupsWithRates({ includeInactive = true } = {}) {
  return prisma.taxGroup.findMany({
    where: includeInactive ? {} : { isActive: true },
    select: {
      id: true,
      name: true,
      isInclusive: true,
      isActive: true,
      rates: {
        select: { id: true, name: true, rate: true, accountId: true, region: true, isCompound: true, sortOrder: true, isActive: true },
        orderBy: { sortOrder: "asc" },
      },
      _count: { select: { products: true, items: true } },
    },
    orderBy: { name: "asc" },
    take: 200,
  });
}

// --- periods ----------------------------------------------------------------

/**
 * Periods with the two facts that decide whether one can be closed.
 *
 * A period with a draft entry still in it cannot be closed, and nor can one
 * with an earlier period still open. Both are refused by the service, and
 * both are much better said on the button than after the click.
 */
export async function periodsWithReadiness({ fiscalYearId = null } = {}) {
  const periods = await prisma.accountingPeriod.findMany({
    where: fiscalYearId ? { fiscalYearId } : {},
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      status: true,
      closedAt: true,
      closedById: true,
      fiscalYear: { select: { id: true, name: true, isClosed: true } },
      _count: { select: { entries: true } },
    },
    orderBy: { startDate: "asc" },
    take: 500,
  });

  const drafts = await prisma.journalEntry.groupBy({
    by: ["periodId"],
    where: { status: "DRAFT", periodId: { in: periods.map((period) => period.id) } },
    _count: { _all: true },
  });
  const draftBy = Object.fromEntries(drafts.map((row) => [row.periodId, row._count._all]));

  let openBefore = 0;
  return periods.map(({ _count, ...period }) => {
    const row = { ...period, entryCount: _count.entries, drafts: draftBy[period.id] ?? 0, earlierOpen: openBefore };
    if (period.status === "OPEN") openBefore += 1;
    return row;
  });
}

export async function fiscalYears() {
  return prisma.fiscalYear.findMany({
    select: { id: true, name: true, startDate: true, endDate: true, isClosed: true, _count: { select: { periods: true } } },
    orderBy: { startDate: "desc" },
    take: 100,
  });
}

// --- tiles ------------------------------------------------------------------

/**
 * Drawers still open, and how long they have been.
 *
 * A session nobody closed is the most common way cash goes missing without
 * anybody noticing: the shift ends, the next one starts against the same
 * drawer, and the two are no longer separable.
 */
export async function openDrawers(principal, { branchId = null } = {}) {
  const filter = branchFilter(branchScope(principal, "cash_registers.read"));
  const rows = await prisma.cashRegisterSession.findMany({
    where: {
      status: "OPEN",
      ...(filter ? { AND: [{ branchId: filter }] } : {}),
      ...(branchId ? { branchId } : {}),
    },
    select: { id: true, branchId: true, registerName: true, openedAt: true, openingFloat: true, openedById: true },
    orderBy: { openedAt: "asc" },
    take: 50,
  });

  return rows;
}

/**
 * What should be in each of these drawers right now.
 *
 * `CashRegisterSession.expectedCash` is only written at close, so an open
 * session has none — and the list fell back to the opening float, which reads
 * as "there is 5,000 in that till" when four thousand has gone through it
 * since. Summed from the movements, the same way the session page derives it.
 */
export async function runningCash(sessionIds = []) {
  const ids = [...new Set(sessionIds.filter(Boolean))];
  if (!ids.length) return {};

  const [sessions, movements] = await Promise.all([
    prisma.cashRegisterSession.findMany({ where: { id: { in: ids } }, select: { id: true, openingFloat: true } }),
    prisma.cashMovement.groupBy({ by: ["sessionId"], where: { sessionId: { in: ids } }, _sum: { amount: true } }),
  ]);

  const moved = Object.fromEntries(movements.map((row) => [row.sessionId, row._sum.amount]));
  return Object.fromEntries(
    sessions.map((row) => [row.id, String(new Prisma.Decimal(row.openingFloat ?? 0).plus(new Prisma.Decimal(moved[row.id] ?? 0)))]),
  );
}

/** Money waiting on somebody: authorisations to capture, refunds to approve. */
export async function waitingOnSomeone(principal) {
  const payFilter = branchFilter(branchScope(principal, "payments.read"));
  const refundFilter = branchFilter(branchScope(principal, "refunds.read"));
  const expenseFilter = branchFilter(branchScope(principal, "expenses.read"));

  const [toCapture, toApprove, toDecide] = await Promise.all([
    can(principal, "payments.read")
      ? prisma.payment.aggregate({
          where: { status: "AUTHORIZED", ...(payFilter ? { AND: [{ branchId: payFilter }] } : {}) },
          _count: { _all: true },
          _sum: { amount: true },
        })
      : null,
    can(principal, "refunds.read")
      ? prisma.refund.aggregate({
          where: { status: "REQUESTED", ...(refundFilter ? { AND: [{ payment: { branchId: refundFilter } }] } : {}) },
          _count: { _all: true },
          _sum: { amount: true },
        })
      : null,
    can(principal, "expenses.read")
      ? prisma.expense.aggregate({
          where: { status: "PENDING_APPROVAL", ...(expenseFilter ? { AND: [{ branchId: expenseFilter }] } : {}) },
          _count: { _all: true },
          _sum: { amount: true },
        })
      : null,
  ]);

  return {
    capture: toCapture ? { count: toCapture._count._all, amount: toCapture._sum.amount ?? 0 } : null,
    refunds: toApprove ? { count: toApprove._count._all, amount: toApprove._sum.amount ?? 0 } : null,
    expenses: toDecide ? { count: toDecide._count._all, amount: toDecide._sum.amount ?? 0 } : null,
  };
}

/** Display names for the loose actor columns these records carry. */
export async function userNames(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return Object.fromEntries(users.map((user) => [user.id, user.name]));
}

/** Branch names for ids a scoped list may contain. */
export async function branchNames(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const rows = await prisma.branch.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return Object.fromEntries(rows.map((row) => [row.id, row.name]));
}
