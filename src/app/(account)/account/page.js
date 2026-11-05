import Link from "next/link";
import { redirect } from "next/navigation";
import { ReceiptText } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listOrders } from "@/server/services/order.service";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { dateLabel, timeLabel } from "@/lib/finance";
import {
  ORDER_FILTERS,
  ORDER_TYPE_LABELS,
  chipClass,
  itemSummary,
  matchesFilter,
  needsAction,
  orderProgress,
} from "@/lib/account";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "My orders — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

/**
 * Everything this person has ordered.
 *
 * Ordered newest first and grouped by whether anything is still happening,
 * because the question somebody opens this page with is almost always about
 * the most recent order rather than the history.
 *
 * Anything needing them — an unpaid order, a failed payment — is lifted out
 * of the row and said plainly. A payment that quietly failed is the one thing
 * on this screen that costs the person a meal if they do not notice it.
 */
export default async function MyOrdersPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/account"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "self.view_own_orders")) redirect("/");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const filter = ORDER_FILTERS.some((row) => row.value === one(params.filter)) ? one(params.filter) : "";
  const cursor = one(params.cursor) || undefined;

  const [{ currency, timeZone }, page] = await Promise.all([
    getSiteIdentity(),
    listOrders({ userId: principal.userId, limit: PAGE_SIZE, cursor }).catch((error) => {
      if (cursor) return listOrders({ userId: principal.userId, limit: PAGE_SIZE });
      throw error;
    }),
  ]);

  const all = serialize(page.items);
  const orders = all.filter((order) => matchesFilter(order, filter));
  const money = (value) => formatMoney(value, currency);

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { filter, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    const text = query.toString();
    return text ? `/account?${text}` : "/account";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My orders"
        description="Everything you have ordered, newest first."
        actions={
          <Link
            href="/menu"
            className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Order again
          </Link>
        }
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter orders">
        {ORDER_FILTERS.map((tab) => (
          <Link
            key={tab.label}
            href={href({ filter: tab.value, cursor: "" })}
            aria-current={filter === tab.value ? "page" : undefined}
            className={`rounded-field px-4 py-2.5 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${filter === tab.value ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {orders.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {orders.map((order) => {
              const progress = orderProgress(order);
              const action = needsAction(order);

              return (
                <li key={order.id} className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/account/orders/${order.id}`}
                          className="font-mono text-label-bold text-on-surface hover:underline"
                        >
                          {order.orderNumber}
                        </Link>
                        <Chip tone={chipClass(progress.tone)}>{progress.label}</Chip>
                      </p>
                      <p className="mt-1 text-body-md text-on-surface-variant">
                        {dateLabel(order.placedAt, timeZone)} at {timeLabel(order.placedAt, timeZone)} ·{" "}
                        {ORDER_TYPE_LABELS[order.type] ?? order.type} · {itemSummary(order)}
                      </p>
                    </div>
                    <p className="tabular-nums text-body-md text-on-surface">{money(order.grandTotal)}</p>
                  </div>

                  {action ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-warning-container px-4 py-3">
                      <p className="text-body-md text-on-warning-container">
                        <span className="font-semibold">{action.label}.</span> {action.detail}
                      </p>
                      <Link
                        href={`/account/orders/${order.id}`}
                        className="rounded-field bg-on-warning-container px-4 py-2 text-label-bold text-warning-container hover:opacity-90"
                      >
                        Sort it out
                      </Link>
                    </div>
                  ) : null}
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
          title={filter ? "Nothing here" : "No orders yet"}
          action={{ href: "/menu", label: "See the menu" }}
        >
          {filter === "open"
            ? "Nothing is in progress right now."
            : filter === "done"
              ? "No finished orders yet."
              : "When you order something, it will show up here."}
        </EmptyState>
      )}
    </div>
  );
}
