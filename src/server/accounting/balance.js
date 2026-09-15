import { Prisma } from "@/generated/prisma";
import { ApiError } from "@/lib/api";

/**
 * Double-entry arithmetic.
 *
 * Pure, and the reason it is pure is that Postgres cannot express the one
 * invariant the whole ledger rests on. "Debits equal credits" is a constraint
 * *across rows*, so no column check, no foreign key and no unique index can
 * enforce it. It has to be enforced in code on the way in and re-checkable
 * afterwards — which means the arithmetic must be testable without a database,
 * because a bug here is a set of books that does not add up and a report nobody
 * can reconcile.
 *
 * Two conventions hold everywhere:
 *
 *   * **A line is a debit or a credit, never both, and never negative.** A
 *     "negative credit" is a debit, and allowing it would mean the same entry
 *     could be written four different ways — of which three are unreadable and
 *     one silently breaks any report that sums a column.
 *   * **Normal balance decides the sign of a balance, not of a line.** An asset
 *     grows on the debit side and a liability on the credit side, so the same
 *     raw numbers mean opposite things depending on the account.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);
const ZERO = D(0);

/** Money is Decimal(18,4) throughout the ledger; round there and nowhere else. */
export function money(value) {
  return D(value).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

/** Account types that increase on the debit side. */
export const DEBIT_NORMAL_TYPES = ["ASSET", "EXPENSE"];

export function normalBalanceFor(type) {
  return DEBIT_NORMAL_TYPES.includes(type) ? "DEBIT" : "CREDIT";
}

/**
 * The balance of an account, signed in its own normal direction.
 *
 * A cash account with 500 debit and 200 credit has 300. A payable with 200
 * debit and 500 credit also has 300 — it owes 300. Both read as positive,
 * which is what makes a trial balance legible: a negative number means the
 * account is behaving abnormally and wants looking at.
 */
export function accountBalance({ normalBalance, debit, credit }) {
  const debits = D(debit);
  const credits = D(credit);

  return money(normalBalance === "DEBIT" ? debits.minus(credits) : credits.minus(debits));
}

/**
 * Checks and normalises one line.
 *
 * Rejects the ambiguous shapes rather than interpreting them. A line with both
 * a debit and a credit is somebody's netting shortcut, and it makes the account
 * unreadable as soon as anybody asks what actually moved.
 */
export function normaliseLine(line, index = 0) {
  const debit = money(line.debit ?? 0);
  const credit = money(line.credit ?? 0);

  if (debit.lessThan(0) || credit.lessThan(0)) {
    throw ApiError.validation("A journal line cannot be negative", {
      [`lines.${index}`]: ["Write the amount on the other side instead of using a negative"],
    });
  }

  if (debit.greaterThan(0) && credit.greaterThan(0)) {
    throw ApiError.validation("A journal line is a debit or a credit, not both", {
      [`lines.${index}`]: ["Split it into two lines"],
    });
  }

  if (debit.isZero() && credit.isZero()) {
    throw ApiError.validation("A journal line has to move something", {
      [`lines.${index}`]: ["Give either a debit or a credit"],
    });
  }

  return { ...line, debit, credit };
}

/** Totals a set of lines and says whether they balance. */
export function totals(lines) {
  let totalDebit = ZERO;
  let totalCredit = ZERO;

  for (const line of lines) {
    totalDebit = totalDebit.plus(D(line.debit ?? 0));
    totalCredit = totalCredit.plus(D(line.credit ?? 0));
  }

  const difference = totalDebit.minus(totalCredit);

  return {
    totalDebit: money(totalDebit),
    totalCredit: money(totalCredit),
    difference: money(difference),
    balanced: money(difference).isZero(),
  };
}

/**
 * The gate every posting goes through.
 *
 * Throws with the actual difference in the message, because "out of balance by
 * 0.01" tells whoever is reading the error where to look, and "unbalanced
 * entry" does not.
 */
export function assertBalanced(lines) {
  if (!lines?.length) {
    throw ApiError.validation("A journal entry needs lines", { lines: ["Add at least two lines"] });
  }

  if (lines.length < 2) {
    // One line cannot balance against anything. Nearly always a caller that
    // built the other side conditionally and lost it.
    throw ApiError.validation("A journal entry needs at least two lines", {
      lines: ["Double entry: something has to be on the other side"],
    });
  }

  const normalised = lines.map(normaliseLine);
  const result = totals(normalised);

  if (!result.balanced) {
    throw ApiError.validation(
      `Debits and credits differ by ${result.difference}`,
      {
        lines: [`Debits total ${result.totalDebit}, credits total ${result.totalCredit}`],
      },
    );
  }

  return { lines: normalised, ...result };
}

/**
 * Flips every line, for a reversal.
 *
 * A correction is a new entry that undoes the old one, never an edit or a
 * delete. The original stays exactly as it was posted, which is what makes an
 * audit trail worth having — a ledger where mistakes vanish cannot be used to
 * prove anything.
 */
export function reverseLines(lines) {
  return lines.map((line) => ({
    accountId: line.accountId,
    accountCode: line.accountCode,
    debit: money(line.credit ?? 0),
    credit: money(line.debit ?? 0),
    description: line.description,
    branchId: line.branchId ?? null,
    departmentId: line.departmentId ?? null,
    partyType: line.partyType ?? null,
    partyId: line.partyId ?? null,
    sortOrder: line.sortOrder ?? 0,
  }));
}

/**
 * Drops lines that move nothing, then checks what is left.
 *
 * Posting rules build lines from figures that are often zero — an order with no
 * delivery fee, a run with no overhead — and a zero line is noise in the
 * ledger rather than information. Cleaning them out here means every rule can
 * be written as a flat list without a conditional around each entry.
 */
export function compact(lines) {
  return lines.filter((line) => !D(line.debit ?? 0).isZero() || !D(line.credit ?? 0).isZero());
}

/** `debit` and `credit` helpers, so a rule reads like the entry it produces. */
export function debitLine(accountCode, amount, extra = {}) {
  return { accountCode, debit: money(amount), credit: ZERO, ...extra };
}

export function creditLine(accountCode, amount, extra = {}) {
  return { accountCode, debit: ZERO, credit: money(amount), ...extra };
}

/**
 * Puts an amount on whichever side its sign calls for.
 *
 * Rounding, cash variance and stock adjustments all go both ways, and writing
 * `amount < 0 ? credit : debit` at each call site is how a sign eventually gets
 * inverted in one of them.
 */
export function signedLine(accountCode, amount, { debitWhenPositive = true, ...extra } = {}) {
  const value = money(amount);
  if (value.isZero()) return null;

  const positive = value.greaterThan(0);
  const onDebit = positive === debitWhenPositive;

  return onDebit
    ? debitLine(accountCode, value.abs(), extra)
    : creditLine(accountCode, value.abs(), extra);
}
