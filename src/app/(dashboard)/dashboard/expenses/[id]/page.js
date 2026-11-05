import Link from "next/link";
import { requireReachable } from "@/lib/api/page";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import ActionButton from "@/components/dashboard/inventory/ActionButton";
import ExpenseForm from "@/components/dashboard/finance/ExpenseForm";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getExpense } from "@/server/services/expense.service";
import { assertRecordAccess } from "@/server/finance/access";
import {
  branchNames,
  expenseCategoryOptions,
  paymentSourceAccounts,
  scopedBranches,
  userNames,
} from "@/server/content/finance-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { EXPENSE_STATES, dateLabel, expenseIsLocked, expenseNet, expenseTotal, timeLabel } from "@/lib/finance";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Expense — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * One expense, and whatever it is waiting for.
 *
 * An approved expense is in the ledger, so the form disappears and the only
 * remaining route is a reversal. Editing a figure that has already moved the
 * profit and loss would leave the books disagreeing with the record of why.
 */
export default async function ExpensePage({ params }) {
  const principal = await getAuthContext();
  const { id } = await params;
  if (!principal) redirect(loginHref(`/dashboard/expenses/${id}`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "expenses.read")) redirect("/dashboard");

  await requireReachable(assertRecordAccess(principal, "expense", id, "expenses.read"));

  const expense = serialize(
    await requireReachable(getExpense(id)));
  const state = EXPENSE_STATES[expense.status] ?? { label: expense.status, tone: "", note: "" };
  const locked = expenseIsLocked(expense);

  const [{ currency }, names, people, branches, categories, accounts] = await Promise.all([
    getSiteIdentity(),
    branchNames([expense.branchId]),
    userNames([expense.createdById, expense.approvedById]),
    scopedBranches(principal, "expenses.create"),
    expenseCategoryOptions({ includeInactive: true }),
    paymentSourceAccounts(),
  ]);

  const canEdit = !locked && expense.status !== "REJECTED" && can(principal, "expenses.create", { branchId: expense.branchId });
  const canApprove = can(principal, "expenses.approve", { branchId: expense.branchId });
  const canDelete = can(principal, "expenses.delete", { branchId: expense.branchId });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={expense.expenseNumber}
        description={state.note}
        back={{ href: "/dashboard/expenses", label: "Expenses" }}
        actions={<Chip tone={state.tone}>{state.label}</Chip>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5 lg:col-span-2">
          <h2 className="font-display text-headline-md text-on-surface">What was paid</h2>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {[
              ["Payee", expense.payee ?? "—"],
              ["Branch", names[expense.branchId] ?? "—"],
              ["Date", dateLabel(expense.expenseDate)],
              ["Category", expense.category?.name ?? "Uncategorised"],
              ["Posts to", expense.category?.account ? `${expense.category.account.code} ${expense.category.account.name}` : "—"],
              ["Paid from", expense.paidFrom ? `${expense.paidFrom.code} ${expense.paidFrom.name}` : "—"],
              ["Recorded by", people[expense.createdById] ?? "—"],
              ["Approved by", people[expense.approvedById] ?? "—"],
              ["Approved", timeLabel(expense.approvedAt)],
            ]
              .filter(([, value]) => value && value !== "—")
              .map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-label-bold text-on-surface-variant">{label}</dt>
                  <dd className="break-words text-body-md text-on-surface">{value}</dd>
                </div>
              ))}
          </dl>
          {expense.description ? <p className="text-body-md text-on-surface">{expense.description}</p> : null}
          {expense.receiptUrl ? (
            <a
              href={expense.receiptUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="w-fit text-label-bold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Open the receipt
            </a>
          ) : (
            <p className="text-body-md text-on-surface-variant">No receipt attached.</p>
          )}
        </section>

        <section className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">Amount</h2>
          <dl className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-label-bold text-on-surface">Off the receipt</dt>
              <dd className="tabular-nums text-label-bold text-on-surface">{formatMoney(expenseTotal(expense), expense.currency ?? currency)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-body-md text-on-surface-variant">Of which tax</dt>
              <dd className="tabular-nums text-body-md text-on-surface">{formatMoney(expense.taxAmount, expense.currency ?? currency)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-outline-variant pt-2">
              <dt className="text-body-md text-on-surface-variant">The cost</dt>
              <dd className="tabular-nums text-body-md text-on-surface">{formatMoney(expenseNet(expense), expense.currency ?? currency)}</dd>
            </div>
          </dl>
          <p className="text-body-md text-on-surface-variant">
            The tax sits inside the total rather than on top of it. Only the remainder is a cost; the tax may be
            recoverable, so the ledger books the two separately.
          </p>
        </section>
      </div>

      <section className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
        <h2 className="font-display text-headline-md text-on-surface">What you can do</h2>
        <div className="flex flex-wrap gap-3">
          {expense.status === "DRAFT" && canEdit ? (
            <ActionButton
              endpoint={`/admin/expenses/${expense.id}/submit`}
              success="Sent for approval."
              tone="primary"
            >
              Send for approval
            </ActionButton>
          ) : null}

          {expense.status === "PENDING_APPROVAL" && canApprove ? (
            <>
              <ActionButton
                endpoint={`/admin/expenses/${expense.id}/approve`}
                confirm={`Approve ${formatMoney(expenseTotal(expense), expense.currency ?? currency)}? It posts to the ledger as a cost.`}
                success="Approved and posted."
                tone="primary"
              >
                Approve it
              </ActionButton>
              <ActionButton
                endpoint={`/admin/expenses/${expense.id}/reject`}
                confirm="Turn this expense down?"
                success="Rejected."
                tone="danger"
              >
                Turn it down
              </ActionButton>
            </>
          ) : null}

          {expense.status === "DRAFT" && canDelete ? (
            <ActionButton
              method="delete"
              endpoint={`/admin/expenses/${expense.id}`}
              confirm="Delete this draft?"
              success="Deleted."
              tone="danger"
              redirectTo="/dashboard/expenses"
            >
              Delete the draft
            </ActionButton>
          ) : null}
        </div>

        {locked ? (
          <p className="text-body-md text-on-surface-variant">
            This is in the ledger. Correcting it means reversing the journal entry it created, not editing the figure
            here — otherwise the books would stop agreeing with the record of why.
          </p>
        ) : null}
      </section>

      {canEdit ? (
        <section className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">Edit</h2>
          <ExpenseForm
            expense={expense}
            branches={serialize(branches.length ? branches : [{ id: expense.branchId, name: names[expense.branchId] ?? "This branch" }])}
            categories={serialize(categories)}
            accounts={serialize(accounts)}
          />
        </section>
      ) : null}

      <p className="text-body-md text-on-surface-variant">
        <Link href="/dashboard/journal?source=EXPENSE" className="hover:underline">
          See expense postings in the journal
        </Link>
      </p>
    </div>
  );
}
