import { Prisma } from "@/generated/prisma";
import { accountBalance, money } from "@/server/accounting/balance";

/**
 * Financial statement arithmetic.
 *
 * Pure, and separated from the queries for one reason above all: **a balance
 * sheet only balances if the current period's profit is carried into equity**,
 * and that is the single most common way a home-grown ledger produces a report
 * that is visibly wrong. Income and expense accounts are period accounts — they
 * are closed into retained earnings at year end — so a balance sheet drawn
 * mid-year that reads equity straight off the ledger will be out by exactly the
 * profit earned so far.
 *
 * Getting that wrong is not subtle and it is not recoverable by squinting: the
 * two sides differ, and the only way to know the formula is right is to be able
 * to test it against figures on paper.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);
const ZERO = D(0);

/**
 * A trial balance: every account with a balance, in its own normal direction.
 *
 * The first thing anybody looks at when the books are suspect, because the
 * totals must agree. They agree by construction if every entry balanced — so a
 * disagreement here means something wrote to the ledger without going through
 * the posting service.
 */
export function trialBalance(rows) {
  const accounts = rows
    .map((row) => {
      const debit = D(row.debit);
      const credit = D(row.credit);
      const balance = accountBalance({ normalBalance: row.normalBalance, debit, credit });

      return {
        accountId: row.accountId,
        code: row.code,
        name: row.name,
        type: row.type,
        normalBalance: row.normalBalance,
        debit: money(debit),
        credit: money(credit),
        balance,
        // A balance on the wrong side of its own account is not always an
        // error — cash over/short does it legitimately — but it is always
        // worth a second look, so it is flagged rather than hidden.
        isContrary: balance.lessThan(0),
      };
    })
    .filter((row) => !D(row.debit).isZero() || !D(row.credit).isZero())
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));

  const totalDebit = accounts.reduce((sum, row) => sum.plus(D(row.debit)), ZERO);
  const totalCredit = accounts.reduce((sum, row) => sum.plus(D(row.credit)), ZERO);

  return {
    accounts,
    totalDebit: money(totalDebit),
    totalCredit: money(totalCredit),
    difference: money(totalDebit.minus(totalCredit)),
    balanced: money(totalDebit.minus(totalCredit)).isZero(),
  };
}

function sectionOf(rows, type) {
  return rows.filter((row) => row.type === type);
}

/**
 * The balance of a row in the direction its **section** grows, not the
 * direction its own account does.
 *
 * This distinction is the one that bites. A contra-income account such as
 * "Discounts given" is DEBIT-normal but lives in the income section: read in
 * its own direction it is a positive 100, and a P&L that trusts that adds the
 * discount to revenue instead of subtracting it. Read in its section's
 * direction it is -100, and the arithmetic falls out correctly with no special
 * case anywhere.
 */
function sectionBalance(row) {
  const debit = D(row.debit ?? 0);
  const credit = D(row.credit ?? 0);

  // Assets and expenses grow on the debit side; everything else on the credit.
  return ["ASSET", "EXPENSE"].includes(row.type) ? debit.minus(credit) : credit.minus(debit);
}

function sumBalances(rows) {
  return rows.reduce((sum, row) => sum.plus(sectionBalance(row)), ZERO);
}

/**
 * Profit and loss for a period.
 *
 * Income accounts are summed in their normal (credit) direction, which makes a
 * contra-income account such as "Discounts given" — a DEBIT-normal account in
 * the income section — come through as a negative balance and reduce revenue
 * without anybody special-casing it. That is the whole reason discounts are
 * modelled as contra-income rather than as an expense: the arithmetic falls out
 * correctly, and gross revenue and net revenue are both readable.
 */
export function profitAndLoss(rows) {
  const income = sectionOf(rows, "INCOME");
  const expense = sectionOf(rows, "EXPENSE");

  // Read in the income section's own direction, a contra account comes through
  // negative and reduces revenue without anybody special-casing it.
  const grossRevenue = income
    .filter((row) => sectionBalance(row).greaterThanOrEqualTo(0))
    .reduce((sum, row) => sum.plus(sectionBalance(row)), ZERO);
  const contraRevenue = income
    .filter((row) => sectionBalance(row).lessThan(0))
    .reduce((sum, row) => sum.plus(sectionBalance(row).abs()), ZERO);

  const netRevenue = grossRevenue.minus(contraRevenue);

  const costOfSales = expense
    .filter((row) => ["COGS", "Production"].includes(row.subType))
    .reduce((sum, row) => sum.plus(sectionBalance(row)), ZERO);
  const operatingExpenses = expense
    .filter((row) => !["COGS", "Production"].includes(row.subType))
    .reduce((sum, row) => sum.plus(sectionBalance(row)), ZERO);

  const grossProfit = netRevenue.minus(costOfSales);
  const netProfit = grossProfit.minus(operatingExpenses);

  return {
    grossRevenue: money(grossRevenue),
    contraRevenue: money(contraRevenue),
    netRevenue: money(netRevenue),
    costOfSales: money(costOfSales),
    grossProfit: money(grossProfit),
    operatingExpenses: money(operatingExpenses),
    netProfit: money(netProfit),
    // The number a restaurant is actually run on.
    grossMarginPercent: netRevenue.greaterThan(0)
      ? Number(grossProfit.dividedBy(netRevenue).times(100).toDecimalPlaces(2))
      : null,
    netMarginPercent: netRevenue.greaterThan(0)
      ? Number(netProfit.dividedBy(netRevenue).times(100).toDecimalPlaces(2))
      : null,
    income: income.map((row) => ({ ...row, balance: money(sectionBalance(row)) })),
    expenses: expense.map((row) => ({ ...row, balance: money(sectionBalance(row)) })),
  };
}

/**
 * The balance sheet, as at a date.
 *
 * `currentEarnings` is the profit for the year so far, computed from the same
 * income and expense rows and added to equity. Without it the statement is out
 * by exactly that amount — the error this module exists to make impossible.
 */
export function balanceSheet(rows) {
  const assets = sectionOf(rows, "ASSET");
  const liabilities = sectionOf(rows, "LIABILITY");
  const equity = sectionOf(rows, "EQUITY");

  const totalAssets = sumBalances(assets);
  const totalLiabilities = sumBalances(liabilities);
  const postedEquity = sumBalances(equity);

  // Income and expense accounts have not been closed out yet, so what they
  // hold is this year's profit and it belongs in equity.
  const pnl = profitAndLoss(rows);
  const currentEarnings = D(pnl.netProfit);

  const totalEquity = postedEquity.plus(currentEarnings);
  const difference = totalAssets.minus(totalLiabilities.plus(totalEquity));

  return {
    assets: assets.map((row) => ({ ...row, balance: money(sectionBalance(row)) })),
    liabilities: liabilities.map((row) => ({ ...row, balance: money(sectionBalance(row)) })),
    equity: equity.map((row) => ({ ...row, balance: money(sectionBalance(row)) })),
    totalAssets: money(totalAssets),
    totalLiabilities: money(totalLiabilities),
    postedEquity: money(postedEquity),
    currentEarnings: money(currentEarnings),
    totalEquity: money(totalEquity),
    totalLiabilitiesAndEquity: money(totalLiabilities.plus(totalEquity)),
    difference: money(difference),
    balanced: money(difference).isZero(),
  };
}

/**
 * Cash flow, direct method.
 *
 * Built from what actually moved through the cash and bank accounts rather than
 * derived backwards from profit. For a restaurant that is both the more useful
 * statement and the more honest one: takings, supplier payments, wages and
 * rent are real movements somebody can check against a bank statement, whereas
 * an indirect statement reconciles to a profit figure that already depends on
 * every accrual being right.
 *
 * `movements` are the journal lines that hit a cash account, each carrying the
 * other side of its own entry so the flow can be categorised.
 */
export function cashFlow(movements) {
  const buckets = new Map();
  let inflow = ZERO;
  let outflow = ZERO;

  for (const movement of movements) {
    const amount = D(movement.debit).minus(D(movement.credit));
    if (amount.isZero()) continue;

    if (amount.greaterThan(0)) inflow = inflow.plus(amount);
    else outflow = outflow.plus(amount.abs());

    const key = movement.category ?? "Other";
    buckets.set(key, (buckets.get(key) ?? ZERO).plus(amount));
  }

  const categories = [...buckets.entries()]
    .map(([category, amount]) => ({ category, amount: money(amount) }))
    .sort((a, b) => Number(D(b.amount).abs().minus(D(a.amount).abs())));

  return {
    inflow: money(inflow),
    outflow: money(outflow),
    netChange: money(inflow.minus(outflow)),
    categories,
  };
}

/**
 * Ages open balances into the usual buckets.
 *
 * Used for both payables and receivables. `asOf` matters: an ageing run against
 * today and one against a month end give different answers for the same
 * invoices, and quoting one as the other is how a supplier ends up chased for
 * something that was not yet due.
 */
export const AGEING_BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"];

export function bucketFor(dueDate, asOf = new Date()) {
  const due = new Date(dueDate);
  const days = Math.floor((new Date(asOf).getTime() - due.getTime()) / 86_400_000);

  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export function ageBalances(items, asOf = new Date()) {
  const totals = Object.fromEntries(AGEING_BUCKETS.map((bucket) => [bucket, ZERO]));
  const rows = [];

  for (const item of items) {
    const outstanding = D(item.outstanding);
    if (outstanding.lessThanOrEqualTo(0)) continue;

    const bucket = bucketFor(item.dueDate, asOf);
    totals[bucket] = totals[bucket].plus(outstanding);
    rows.push({ ...item, outstanding: money(outstanding), bucket });
  }

  const total = Object.values(totals).reduce((sum, value) => sum.plus(value), ZERO);

  return {
    rows: rows.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)),
    buckets: Object.fromEntries(AGEING_BUCKETS.map((bucket) => [bucket, money(totals[bucket])])),
    total: money(total),
  };
}
