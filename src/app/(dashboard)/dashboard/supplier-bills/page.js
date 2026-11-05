import Link from "next/link";
import { redirect } from "next/navigation";
import { FileSpreadsheet, Plus } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import BillFromReceipt from "@/components/dashboard/purchasing/BillFromReceipt";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listSupplierBills } from "@/server/services/supplier-bill.service";
import { actionableBranches, billCounts, scopedBranches, supplierOptions, unbilledReceipts } from "@/server/content/purchasing-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { BILL_FILTERS, BILL_STATES, dateLabel, dueState, outstandingOf } from "@/lib/purchasing";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Supplier bills — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/**
 * What the restaurant owes its suppliers.
 *
 * The panel of unbilled deliveries above the list is the part that saves
 * money. Stock that has been received but never invoiced sits in "goods
 * received not invoiced": the food is on the books and nobody has checked
 * whether the restaurant was charged what it agreed. Left alone the pile grows
 * quietly, and it is always discovered at a year end.
 */
export default async function SupplierBillsPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/supplier-bills"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "supplier_bills.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const scope = branchScope(principal, "supplier_bills.read");

  const [counts, branches, suppliers, { currency, timeZone }, creatable, unbilled] = await Promise.all([
    billCounts(principal),
    scopedBranches(principal, "supplier_bills.read"),
    supplierOptions({ includeInactive: true }),
    getSiteIdentity(),
    actionableBranches(principal, "supplier_bills.create"),
    unbilledReceipts(principal, { limit: 6 }),
  ]);

  const requested = one(params.status);
  const known = BILL_FILTERS.some((row) => row.value === requested);
  const status = known ? requested : counts.AWAITING_APPROVAL ? "AWAITING_APPROVAL" : "";
  const branch = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : "";
  const supplier = suppliers.some((row) => row.id === one(params.supplier)) ? one(params.supplier) : "";
  const overdueOnly = one(params.overdue) === "1";
  const cursor = one(params.cursor) || undefined;

  const page = await listSupplierBills({
    ...(status && !overdueOnly ? { status } : {}),
    ...(overdueOnly ? { overdueOnly: true } : {}),
    ...(branch ? { branchId: branch } : {}),
    ...(supplier ? { supplierId: supplier } : {}),
    scope,
    limit: PAGE_SIZE,
    cursor,
  }).catch((error) => {
    if (cursor) return listSupplierBills({ scope, limit: PAGE_SIZE });
    throw error;
  });
  const bills = serialize(page.items);
  const branchName = Object.fromEntries(branches.map((row) => [row.id, row.name]));

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { status, branch, supplier, overdue: overdueOnly ? "1" : "", ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    if (values.status === "") query.set("status", "");
    const text = query.toString();
    return text ? `/dashboard/supplier-bills?${text}` : "/dashboard/supplier-bills";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Supplier bills"
        description="Invoices from suppliers, and what is still owed on them. A bill becomes a payable when it is approved — that is the point at which the restaurant agrees it owes the money."
        actions={
          <>
            <Link
              href="/dashboard/supplier-bills/ageing"
              className="rounded-field bg-surface-container-high px-4 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Payables ageing
            </Link>
            {creatable.length ? (
              <Link
                href="/dashboard/supplier-bills/new"
                className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <Plus aria-hidden="true" className="size-4" />
                Record a bill
              </Link>
            ) : null}
          </>
        }
      />

      {unbilled.length ? (
        <section className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
          <div>
            <h2 className="font-display text-headline-md text-on-surface">Delivered but never invoiced</h2>
            <p className="mt-1 text-body-md text-on-surface-variant">
              The stock is on the books and the supplier has not billed for it. Billing from the delivery copies the
              amounts across, so the invoice can be checked against what actually arrived.
            </p>
          </div>
          <ul className="flex flex-col gap-2">
            {serialize(unbilled).map((receipt) => (
              <li key={receipt.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low px-4 py-3">
                <span className="min-w-0">
                  <Link href={`/dashboard/goods-receipts/${receipt.id}`} className="font-mono text-label-bold text-on-surface hover:underline">
                    {receipt.grnNumber}
                  </Link>
                  <span className="block text-body-md text-on-surface-variant">
                    {receipt.supplier.name} · {dateLabel(receipt.receivedAt, timeZone)} · {formatMoney(receipt.grandTotal, currency)}
                  </span>
                </span>
                {can(principal, "supplier_bills.create", { branchId: receipt.branchId }) ? (
                  <BillFromReceipt receiptId={receipt.id} grnNumber={receipt.grnNumber} label="Bill it" />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by stage">
        {BILL_FILTERS.map((tab) => {
          const active = tab.value === status && !overdueOnly;
          const count = tab.value ? (counts[tab.value] ?? 0) : Object.values(counts).reduce((sum, value) => sum + value, 0);
          return (
            <Link
              key={tab.label}
              href={href({ status: tab.value, overdue: "", cursor: "" })}
              aria-current={active ? "page" : undefined}
              className={`rounded-field px-4 py-2.5 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${active ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
            >
              {tab.label}
              <span className="ml-2 font-normal tabular-nums opacity-80">{count}</span>
            </Link>
          );
        })}
        <Link
          href={href({ overdue: overdueOnly ? "" : "1", status: "", cursor: "" })}
          aria-current={overdueOnly ? "page" : undefined}
          className={`rounded-field px-4 py-2.5 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${overdueOnly ? "bg-error-container text-on-error-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
        >
          Late
        </Link>
      </div>

      <ListFilters
        id="supplier-bills"
        hidden={{ status: overdueOnly ? null : status || null, overdue: overdueOnly ? "1" : null }}
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
            name: "supplier",
            label: "Supplier",
            value: supplier,
            options: [{ value: "", label: "All suppliers" }, ...suppliers.map((row) => ({ value: row.id, label: row.name }))],
          },
        ]}
      />

      {bills.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {bills.map((bill) => {
              const due = dueState(bill);
              const owed = outstandingOf(bill);
              return (
                <li key={bill.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/supplier-bills/${bill.id}`} className="font-mono text-label-bold text-on-surface hover:underline">
                        {bill.billNumber}
                      </Link>
                      <Chip tone={BILL_STATES[bill.status]?.tone}>{BILL_STATES[bill.status]?.label ?? bill.status}</Chip>
                    </p>
                    <p className="mt-1 text-body-md text-on-surface">{bill.supplier.name}</p>
                    <p className="text-body-md text-on-surface-variant">
                      {branches.length > 1 ? `${branchName[bill.branchId] ?? "Another branch"} · ` : ""}
                      invoiced {dateLabel(bill.billDate)}
                      {bill.goodsReceipt ? ` · from ${bill.goodsReceipt.grnNumber}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tabular-nums text-body-md text-on-surface">{formatMoney(bill.grandTotal, bill.currency ?? currency)}</p>
                    {Number(owed) > 0 ? (
                      <p className={`text-label-bold font-normal ${due.tone}`}>
                        {formatMoney(owed, bill.currency ?? currency)} owed · {due.label.toLowerCase()}
                      </p>
                    ) : (
                      <p className="text-label-bold font-normal text-on-surface-variant">Settled</p>
                    )}
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
          icon={FileSpreadsheet}
          title={overdueOnly ? "Nothing is late" : status ? "Nothing at this stage" : "No bills recorded"}
          action={creatable.length ? { href: "/dashboard/supplier-bills/new", label: "Record one" } : null}
        >
          {status || overdueOnly
            ? "Try another tab."
            : "A bill is the supplier's invoice, which usually turns up days after the food does."}
        </EmptyState>
      )}
    </div>
  );
}
