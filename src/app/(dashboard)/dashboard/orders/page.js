import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, ReceiptText } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listOrders } from "@/server/services/order.service";
import { orderScope } from "@/server/ordering/access";
import { actionableBranches, orderCounts, scopedBranches } from "@/server/content/service-admin";
import { formatMoney } from "@/lib/format";
import { ORDER_FILTERS, ORDER_STATES, ORDER_TYPE_LABELS, PAYMENT_STATES, channelLabel, waitingFor } from "@/lib/service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Orders — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/**
 * Every order, and what is waiting on somebody.
 *
 * Opens on the new ones, because an order nobody has accepted is the only
 * state where the restaurant is failing the customer by doing nothing. The
 * wait column is in minutes rather than clock times for the same reason: the
 * question on this screen is always "how long has this been sitting?".
 */
export default async function OrdersPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/orders"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "orders.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);

  const [counts, branches, creatable] = await Promise.all([
    orderCounts(principal),
    scopedBranches(principal, "orders.read"),
    actionableBranches(principal, "orders.create"),
  ]);

  const requested = one(params.status);
  const known = ORDER_FILTERS.some((row) => row.value === requested);
  const status = known ? requested : counts.PENDING ? "PENDING" : "";
  const branch = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : "";
  const search = one(params.q)?.trim() || "";
  const cursor = one(params.cursor) || undefined;

  const page = await listOrders({
    ...(status ? { status } : {}),
    ...(branch ? { branchId: branch } : {}),
    ...(search ? { search } : {}),
    scope: orderScope(principal),
    limit: PAGE_SIZE,
    cursor,
  }).catch((error) => {
    if (cursor) return listOrders({ scope: orderScope(principal), limit: PAGE_SIZE });
    throw error;
  });
  const orders = serialize(page.items);
  const branchName = Object.fromEntries(branches.map((row) => [row.id, row.name]));

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { status, branch, q: search, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    if (values.status === "") query.set("status", "");
    const text = query.toString();
    return text ? `/dashboard/orders?${text}` : "/dashboard/orders";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Orders"
        description="Everything the restaurant is working on, and everything it has finished."
        actions={
          creatable.length ? (
            <Link
              href="/dashboard/orders/new"
              className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Plus aria-hidden="true" className="size-4" />
              Take an order
            </Link>
          ) : null
        }
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {ORDER_FILTERS.map((tab) => {
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
        id="orders"
        hidden={{ status: status || null }}
        fields={[
          { type: "search", name: "q", label: "Search", value: search, placeholder: "Order number, name or phone" },
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
        ]}
      />

      {orders.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {orders.map((order) => {
              const wait = waitingFor(order.placedAt);
              const state = ORDER_STATES[order.status] ?? { label: order.status, tone: "" };
              return (
                <li key={order.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/orders/${order.id}`} className="font-mono text-label-bold text-on-surface hover:underline">
                        {order.orderNumber}
                      </Link>
                      <Chip tone={state.tone}>{state.label}</Chip>
                      {order.paymentState !== "PAID" ? <Chip>{PAYMENT_STATES[order.paymentState] ?? order.paymentState}</Chip> : null}
                    </p>
                    <p className="mt-1 text-body-md text-on-surface">
                      {ORDER_TYPE_LABELS[order.type] ?? order.type}
                      {/* Named, not just flagged: "table" on its own told a
                          cashier scanning for table seven precisely nothing. */}
                      {order.table?.name ? ` · table ${order.table.name}` : ""} · {channelLabel(order.channel)}
                      {order.guestName ? ` · ${order.guestName}` : ""}
                    </p>
                    <p className="text-body-md text-on-surface-variant">
                      {branches.length > 1 ? `${branchName[order.branchId] ?? "Another branch"} · ` : ""}
                      {order.itemCount} {order.itemCount === 1 ? "item" : "items"} ·{" "}
                      <span className={wait.tone}>{wait.label}</span>
                    </p>
                  </div>
                  <p className="tabular-nums text-body-md text-on-surface">{formatMoney(order.grandTotal, order.currency)}</p>
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
          icon={ReceiptText}
          title={search ? "Nothing matches that" : status ? "Nothing at this stage" : "No orders yet"}
          action={creatable.length ? { href: "/dashboard/orders/new", label: "Take one at the counter" } : null}
        >
          {search ? "Try an order number, a name or a phone number." : status ? "Try another tab." : "Orders from the website, the app and the counter all land here."}
        </EmptyState>
      )}
    </div>
  );
}
