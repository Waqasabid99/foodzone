import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText, Plus } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listPurchaseOrders } from "@/server/services/purchase-order.service";
import { actionableBranches, purchaseOrderCounts, scopedBranches, supplierOptions } from "@/server/content/purchasing-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { PO_FILTERS, PO_STATES, dateLabel } from "@/lib/purchasing";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Purchase orders — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/**
 * What has been ordered and where it has got to.
 *
 * Opens on whatever is waiting for a person rather than on everything: an
 * order sitting in "waiting for approval" is a delivery that is not coming,
 * and it is the only stage where nothing happens until somebody acts.
 */
export default async function PurchaseOrdersPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/purchase-orders"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "purchase_orders.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const scope = branchScope(principal, "purchase_orders.read");

  const [counts, branches, suppliers, { currency, timeZone }, creatable] = await Promise.all([
    purchaseOrderCounts(principal),
    scopedBranches(principal, "purchase_orders.read"),
    supplierOptions({ includeInactive: true }),
    getSiteIdentity(),
    actionableBranches(principal, "purchase_orders.create"),
  ]);

  const requested = one(params.status);
  const known = PO_FILTERS.some((row) => row.value === requested);
  const status = known ? requested : counts.PENDING_APPROVAL ? "PENDING_APPROVAL" : "";
  const branch = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : "";
  const supplier = suppliers.some((row) => row.id === one(params.supplier)) ? one(params.supplier) : "";
  const cursor = one(params.cursor) || undefined;

  const page = await listPurchaseOrders({
    ...(status ? { status } : {}),
    ...(branch ? { branchId: branch } : {}),
    ...(supplier ? { supplierId: supplier } : {}),
    scope,
    limit: PAGE_SIZE,
    cursor,
  }).catch((error) => {
    if (cursor) return listPurchaseOrders({ scope, limit: PAGE_SIZE });
    throw error;
  });
  const orders = serialize(page.items);
  const branchName = Object.fromEntries(branches.map((row) => [row.id, row.name]));

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { status, branch, supplier, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    if (values.status === "") query.set("status", "");
    const text = query.toString();
    return text ? `/dashboard/purchase-orders?${text}` : "/dashboard/purchase-orders";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Purchase orders"
        description="What has been ordered, from whom, and what is still to arrive. An order moves no stock — food appears when a delivery is received against it."
        actions={
          creatable.length ? (
            <Link
              href="/dashboard/purchase-orders/new"
              className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Plus aria-hidden="true" className="size-4" />
              New order
            </Link>
          ) : null
        }
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by stage">
        {PO_FILTERS.map((tab) => {
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
        id="purchase-orders"
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
            name: "supplier",
            label: "Supplier",
            value: supplier,
            options: [{ value: "", label: "All suppliers" }, ...suppliers.map((row) => ({ value: row.id, label: row.name }))],
          },
        ]}
      />

      {orders.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {orders.map((order) => (
              <li key={order.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link href={`/dashboard/purchase-orders/${order.id}`} className="font-mono text-label-bold text-on-surface hover:underline">
                      {order.poNumber}
                    </Link>
                    <Chip tone={PO_STATES[order.status]?.tone}>{PO_STATES[order.status]?.label ?? order.status}</Chip>
                  </p>
                  <p className="mt-1 text-body-md text-on-surface">{order.supplier.name}</p>
                  <p className="text-body-md text-on-surface-variant">
                    {branches.length > 1 ? `${branchName[order.branchId] ?? "Another branch"} · ` : ""}
                    {order.lineCount} {order.lineCount === 1 ? "line" : "lines"} · ordered {dateLabel(order.orderDate, timeZone)}
                    {order.expectedAt ? ` · expected ${dateLabel(order.expectedAt, timeZone)}` : ""}
                  </p>
                </div>
                <p className="tabular-nums text-body-md text-on-surface">{formatMoney(order.grandTotal, order.currency ?? currency)}</p>
              </li>
            ))}
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
          icon={FileText}
          title={status ? "Nothing at this stage" : "No orders yet"}
          action={creatable.length ? { href: "/dashboard/purchase-orders/new", label: "Raise one" } : null}
        >
          {status ? "Try another tab." : "An order records what was asked for, at what price, so a delivery can be checked against something."}
        </EmptyState>
      )}
    </div>
  );
}
