import { prisma } from "@/lib/prisma";
import { ApiError, assertBranchAccess } from "@/lib/api";
import { assertCompanyWide, branchScope } from "@/lib/api/permissions";
import { branchFilter, inScope, intersectScopes, recordAccess, scopeWhere } from "@/server/access/scope";

export { branchFilter, inScope, intersectScopes, scopeWhere };

/**
 * Which branch a finance record belongs to, and whether the caller may open it.
 *
 * Finance splits cleanly in two, and the split is the whole design of this
 * file.
 *
 * **Branch data** — a payment was taken at a till, a refund went back out of
 * one, an expense was paid by an outlet, a register session is one cashier's
 * shift, a journal entry records something that happened somewhere. These are
 * scoped. A manager at one outlet who omits the branch filter must not be
 * handed the company's takings.
 *
 * **Company data** — the chart of accounts, tax groups and rates, fiscal years
 * and accounting periods. Deliberately absent from the lookups below. One
 * company keeps one set of books: an account code means the same thing at
 * every outlet, and a period is closed for the whole company or not at all.
 * Scoping them per branch would mean a manager could not read the account
 * their own sales post to, which is not a secret. They are governed by the
 * permission alone — and for the ones that *change* something every branch
 * feels, by `assertCompanyWide`, because a grant pinned to one outlet cannot
 * sensibly authorise closing the books for all of them.
 *
 * A refund reaches its branch through the payment it reverses, and a journal
 * entry may carry no branch at all. Each is resolved by its own path rather
 * than by assuming a `branchId` column: guessing one on a table that has not
 * got it fails open, which is how the last four of these were written.
 */

const LOOKUPS = {
  payment: (id) =>
    prisma.payment.findUnique({ where: { id }, select: { branchId: true } }).then((row) => row && [row.branchId]),

  // A refund has no branch of its own; it belongs wherever the money was taken.
  refund: (id) =>
    prisma.refund
      .findUnique({ where: { id }, select: { payment: { select: { branchId: true } } } })
      .then((row) => row && [row.payment?.branchId ?? null]),

  expense: (id) =>
    prisma.expense.findUnique({ where: { id }, select: { branchId: true } }).then((row) => row && [row.branchId]),

  registerSession: (id) =>
    prisma.cashRegisterSession
      .findUnique({ where: { id }, select: { branchId: true } })
      .then((row) => row && [row.branchId]),

  // `branchId` is nullable here, and a null is meaningful rather than missing:
  // a company-level entry — an opening balance, an inter-branch transfer —
  // genuinely belongs to no outlet. `recordAccess` reads that null as "the
  // permission alone decides", which is the right answer for a set of books
  // kept once for the company.
  journalEntry: (id) =>
    prisma.journalEntry.findUnique({ where: { id }, select: { branchId: true } }).then((row) => row && [row.branchId]),
};

const NOT_FOUND = {
  payment: "Payment not found",
  refund: "Refund not found",
  expense: "Expense not found",
  registerSession: "Register session not found",
  journalEntry: "Journal entry not found",
};

export const { recordBranches, assertRecordAccess } = recordAccess(LOOKUPS, NOT_FOUND);

/**
 * Who may change an account in the chart.
 *
 * `Account.branchId` is nullable and both cases are real: most accounts are
 * shared by the whole company, but a till is genuinely one outlet's. So the
 * answer depends on the account rather than being fixed for the table.
 *
 * A shared account takes a company-wide grant. `can()` with no branch accepts
 * any branch-pinned grant, so without this a finance role scoped to one
 * outlet could rename or deactivate the account every other outlet's sales
 * post to — and a posted line points at it for ever.
 */
export async function assertAccountAccess(principal, accountId, permissionKey) {
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { branchId: true } });
  if (!account) throw ApiError.notFound("Account not found");
  assertAccountBranch(principal, account.branchId, permissionKey);
  return account.branchId;
}

/** The same rule for an account that does not exist yet. */
export function assertAccountBranch(principal, branchId, permissionKey) {
  if (branchId == null) {
    assertCompanyWide(principal, permissionKey);
    return;
  }
  if (!inScope(branchScope(principal, permissionKey), branchId)) {
    throw ApiError.notFound("Account not found");
  }
  assertBranchAccess(principal, branchId, permissionKey);
}

/**
 * Tax groups and rates are company data with no branch column at all, so the
 * rule is simply the stricter grant. A VAT rate pinned to one outlet is not a
 * thing the schema can express, and a branch-scoped grant quietly changing
 * what every outlet charges is the bug that would result from pretending
 * otherwise.
 */
export function assertTaxAccess(principal, permissionKey = "taxes.manage") {
  assertCompanyWide(principal, permissionKey);
}
