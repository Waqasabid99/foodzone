import { prisma } from "@/lib/prisma";
import { branchFilter } from "@/server/access/scope";
import { Prisma } from "@/generated/prisma";
import { ACCOUNTS } from "@/server/accounting/chart";
import { money } from "@/server/accounting/balance";
import { balanceSheet, cashFlow, profitAndLoss, trialBalance } from "@/server/accounting/reports";
import { accountBalances } from "@/server/services/journal.service";

/**
 * The financial statements.
 *
 * Each one is a query plus the pure arithmetic next door. The split matters
 * most for the balance sheet: it only balances when the period's profit is
 * carried into equity, and that formula is unit-tested against figures worked
 * out on paper rather than only against whatever the database happens to hold.
 *
 * Every statement is drawn from POSTED entries only. A draft is somebody's
 * unfinished work, and including it would make a report change under the reader
 * as a colleague typed.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

/** Balances with the sign already applied, as the report functions want them. */
async function balancesFor({ branchId, from, to, scope }) {
  const rows = await accountBalances({ branchId, from, to, scope });

  return rows.map((row) => ({
    ...row,
    balance:
      row.normalBalance === "DEBIT" ? D(row.debit).minus(D(row.credit)) : D(row.credit).minus(D(row.debit)),
  }));
}

export async function trialBalanceReport({ branchId = null, from = null, to = null, scope = null } = {}) {
  const rows = await balancesFor({ branchId, from, to, scope });
  return { ...trialBalance(rows), branchId, from, to };
}

/**
 * Profit and loss for a window.
 *
 * `from` genuinely matters here in a way it does not on a balance sheet: a P&L
 * is a period statement, so running one with no start date silently reports
 * since the beginning of time.
 */
export async function profitAndLossReport({ branchId = null, from = null, to = null, scope = null } = {}) {
  const rows = await balancesFor({ branchId, from, to, scope });
  return { ...profitAndLoss(rows), branchId, from, to };
}

/**
 * The balance sheet as at a date.
 *
 * Deliberately has no `from`: a balance sheet is cumulative, so it is drawn
 * from every entry up to `asOf`. Passing a start date would produce a
 * statement of movements dressed up as a statement of position, and it would
 * not balance.
 */
export async function balanceSheetReport({ branchId = null, asOf = new Date(), scope = null } = {}) {
  const rows = await balancesFor({ branchId, from: null, to: asOf, scope });
  return { ...balanceSheet(rows), branchId, asOf };
}

/**
 * Cash flow, direct method: what actually moved through cash and bank.
 *
 * Each cash line is categorised by the *other* side of its own entry, which is
 * what makes the statement readable — "paid suppliers", "took money at the
 * till" — rather than a list of undifferentiated movements.
 */
export async function cashFlowReport({ branchId = null, from = null, to = null, scope = null } = {}) {
  const filter = branchFilter(scope);
  const cashAccounts = await prisma.account.findMany({
    where: { code: { in: [ACCOUNTS.CASH, ACCOUNTS.BANK, ACCOUNTS.CARD_CLEARING] } },
    select: { id: true, code: true, name: true },
  });
  const cashIds = cashAccounts.map((account) => account.id);
  if (!cashIds.length) return { inflow: money(0), outflow: money(0), netChange: money(0), categories: [] };

  const lines = await prisma.journalLine.findMany({
    where: {
      accountId: { in: cashIds },
      entry: {
        status: "POSTED",
        ...(filter ? { AND: [{ branchId: filter }] } : {}),
        ...(branchId ? { branchId } : {}),
        ...(from || to
          ? { entryDate: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
          : {}),
      },
    },
    select: {
      debit: true,
      credit: true,
      entry: {
        select: {
          id: true,
          source: true,
          lines: { select: { accountId: true, account: { select: { code: true, name: true, type: true } } } },
        },
      },
    },
  });

  const movements = lines.map((line) => {
    // The counterpart with the largest opposite movement names the flow.
    const counterpart = line.entry.lines
      .filter((other) => !cashIds.includes(other.accountId))
      .map((other) => other.account)
      .find(Boolean);

    return {
      debit: line.debit,
      credit: line.credit,
      category: counterpart ? `${counterpart.code} ${counterpart.name}` : line.entry.source,
    };
  });

  return { ...cashFlow(movements), branchId, from, to, accounts: cashAccounts };
}

/**
 * Everything at once, for a period-close pack.
 *
 * Includes the trial balance's own agreement and the balance sheet's, because a
 * pack whose statements do not tie is a pack nobody should sign off — and that
 * is much better said on the page than discovered later.
 */
export async function financialSummary({ branchId = null, from = null, to = new Date(), scope = null } = {}) {
  const [pnl, sheet, trial] = await Promise.all([
    profitAndLossReport({ branchId, from, to, scope }),
    balanceSheetReport({ branchId, asOf: to, scope }),
    trialBalanceReport({ branchId, from, to, scope }),
  ]);

  return {
    profitAndLoss: pnl,
    balanceSheet: sheet,
    trialBalance: { totalDebit: trial.totalDebit, totalCredit: trial.totalCredit, balanced: trial.balanced },
    checks: {
      trialBalanceAgrees: trial.balanced,
      balanceSheetBalances: sheet.balanced,
      healthy: trial.balanced && sheet.balanced,
    },
    branchId,
    from,
    to,
  };
}
