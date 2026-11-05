import Link from "next/link";
import { redirect } from "next/navigation";
import { Banknote, Plus } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import StatTile from "@/components/dashboard/StatTile";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listExpenses } from "@/server/services/expense.service";
import {
  actionableBranches,
  branchNames,
  expenseCategoryOptions,
  expenseCounts,
  scopedBranches,
  waitingOnSomeone,
} from "@/server/content/finance-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { EXPENSE_FILTERS, EXPENSE_STATES, dateLabel, expenseTotal } from "@/lib/finance";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Expenses — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/**
 * Operating spend that is not a supplier bill: utilities, fuel, repairs.
 *
 * Nothing here is a cost until it is approved. A draft is somebody's note to
 * themselves; an approved expense has moved the profit and loss. The tabs
 * lead with whatever is waiting for a decision, because an unapproved pile is
 * a P&L that is quietly understating what the month cost.
 */
export default async function ExpensesPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/expenses"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "expenses.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const scope = branchScope(principal, "expenses.read");

  const [counts, branches, categories, { currency }, creatable, waiting] = await Promise.all([
    expenseCounts(principal),
    scopedBranches(principal, "expenses.read"),
    expenseCategoryOptions({ includeInactive: true }),
    getSiteIdentity(),
    actionableBranches(principal, "expenses.create"),
    waitingOnSomeone(principal),
  ]);

  const requested = one(params.status);
  const known = EXPENSE_FILTERS.some((row) => row.value === requested);
  const status = known ? requested : counts.PENDING_APPROVAL ? "PENDING_APPROVAL" : "";
  const branch = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : "";
  const category = categories.some((row) => row.id === one(params.category)) ? one(params.category) : "";
  const from = one(params.from) ?? "";
  const to = one(params.to) ?? "";
  const cursor = one(params.cursor) || undefined;

  const page = await listExpenses({
    ...(status ? { status } : {}),
    ...(branch ? { branchId: branch } : {}),
    ...(category ? { categoryId: category } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    scope,
    limit: PAGE_SIZE,
    cursor,
  }).catch((error) => {
    if (cursor) return listExpenses({ scope, limit: PAGE_SIZE });
    throw error;
  });

  const expenses = serialize(page.items);
  const names = await branchNames(expenses.map((row) => row.branchId));

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { status, branch, category, from, to, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    if (values.status === "") query.set("status", "");
    const text = query.toString();
    return text ? `/dashboard/expenses?${text}` : "/dashboard/expenses";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Expenses"
        description="What the business spends outside its suppliers. Recorded as a draft, and a cost in the books only once it is approved."
        actions={
          creatable.length ? (
            <Link
              href="/dashboard/expenses/new"
              className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Plus aria-hidden="true" className="size-4" />
              Record spend
            </Link>
          ) : null
        }
      />

      {waiting.expenses?.count ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile
            label="Waiting for approval"
            value={formatMoney(waiting.expenses.amount, currency)}
            note={`${waiting.expenses.count} ${waiting.expenses.count === 1 ? "expense" : "expenses"} not yet a cost in the books.`}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by stage">
        {EXPENSE_FILTERS.map((tab) => {
          const active = tab.value === status;
          const count = tab.value ? (counts[tab.value] ?? 0) : Object.values(counts).reduce((sum, value) => sum + value, 0);
          return (
            <Link
              key={tab.label}
              href={href({ status: tab.value, cursor: "" })}
              aria-current={active ? "page" : undefined}
              className={`rounded-field px-4 py-2.5 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${active ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
            >
              {tab.label}
              <span className="ml-2 font-normal tabular-nums opacity-80">{count}</span>
            </Link>
          );
        })}
      </div>

      <ListFilters
        id="expenses"
        hidden={{ status: status || null }}
        fields={[
          ...(branches.length > 1
            ? [
                {
                  type: "select",
                  name: "branch",
                  label: "Branch",
                  value: branch,
                  options: [{ value: "", label: "All branches" }, ...branches.map((row) => ({ value: row.id, label: row.name }))],
                },
              ]
            : []),
          {
            type: "select",
            name: "category",
            label: "Category",
            value: category,
            options: [{ value: "", label: "Any category" }, ...categories.map((row) => ({ value: row.id, label: row.name }))],
          },
          { type: "date", name: "from", label: "From", value: from },
          { type: "date", name: "to", label: "To", value: to },
        ]}
      />

      {expenses.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {expenses.map((expense) => {
              const state = EXPENSE_STATES[expense.status] ?? { label: expense.status, tone: "" };
              return (
                <li key={expense.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/expenses/${expense.id}`} className="font-mono text-label-bold text-on-surface hover:underline">
                        {expense.expenseNumber}
                      </Link>
                      <Chip tone={state.tone}>{state.label}</Chip>
                    </p>
                    <p className="mt-1 text-body-md text-on-surface">{expense.payee ?? expense.category?.name ?? "Uncategorised"}</p>
                    <p className="text-body-md text-on-surface-variant">
                      {branches.length > 1 ? `${names[expense.branchId] ?? "Another branch"} · ` : ""}
                      {dateLabel(expense.expenseDate)}
                      {expense.category ? ` · ${expense.category.name}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tabular-nums text-body-md text-on-surface">
                      {formatMoney(expenseTotal(expense), expense.currency ?? currency)}
                    </p>
                    {Number(expense.taxAmount) > 0 ? (
                      <p className="text-label-bold font-normal text-on-surface-variant">
                        incl. {formatMoney(expense.taxAmount, expense.currency ?? currency)} tax
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          {cursor || page.nextCursor ? (
            <div className="flex flex-wrap gap-2">
              {cursor ? (
                <Link href={href({ cursor: "" })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">
                  Newest
                </Link>
              ) : null}
              {page.nextCursor ? (
                <Link href={href({ cursor: page.nextCursor })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">
                  Older
                </Link>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState
          icon={Banknote}
          title={status ? "Nothing at this stage" : "No expenses recorded"}
          action={creatable.length ? { href: "/dashboard/expenses/new", label: "Record one" } : null}
        >
          {status ? "Try another tab." : "Utilities, fuel, repairs — anything the business pays for that is not a supplier invoice."}
        </EmptyState>
      )}
    </div>
  );
}
