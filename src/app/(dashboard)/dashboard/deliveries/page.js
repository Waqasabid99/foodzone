import Link from "next/link";
import { redirect } from "next/navigation";
import { Bike } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listDeliveries } from "@/server/services/delivery.service";
import { deliveryCounts, scopedBranches } from "@/server/content/delivery-admin";
import { DELIVERY_FILTERS, DELIVERY_STATES, waitingSince } from "@/lib/delivery";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Deliveries — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/**
 * Every delivery, as a record rather than a board.
 *
 * Dispatch is the live screen; this is the one somebody opens when a customer
 * rings about last Tuesday. Opens on the unassigned jobs anyway, because a
 * delivery nobody has taken is the only state where food is going cold while
 * the system waits.
 */
export default async function DeliveriesPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/deliveries"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "deliveries.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const scope = branchScope(principal, "deliveries.read");

  const [counts, branches] = await Promise.all([deliveryCounts(principal), scopedBranches(principal, "deliveries.read")]);

  const requested = one(params.status);
  const known = DELIVERY_FILTERS.some((row) => row.value === requested);
  const status = known ? requested : counts.PENDING ? "PENDING" : "";
  const branch = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : "";
  const cursor = one(params.cursor) || undefined;

  const page = await listDeliveries({
    ...(status ? { status } : {}),
    ...(branch ? { branchId: branch } : {}),
    scope,
    limit: PAGE_SIZE,
    cursor,
  }).catch((error) => {
    if (cursor) return listDeliveries({ scope, limit: PAGE_SIZE });
    throw error;
  });
  const deliveries = serialize(page.items);
  const branchName = Object.fromEntries(branches.map((row) => [row.id, row.name]));

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { status, branch, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    if (values.status === "") query.set("status", "");
    const text = query.toString();
    return text ? `/dashboard/deliveries?${text}` : "/dashboard/deliveries";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Deliveries"
        description="Every job, and where it got to. For the live view during a rush, use Dispatch."
        actions={
          <Link
            href="/dashboard/dispatch"
            className="rounded-field bg-primary-container px-4 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Open dispatch
          </Link>
        }
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {DELIVERY_FILTERS.map((tab) => {
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

      {branches.length > 1 ? (
        <ListFilters
          id="deliveries"
          hidden={{ status: status || null }}
          fields={[
            {
              type: "select",
              name: "branch",
              label: "Branch",
              value: branch,
              options: [{ value: "", label: "All branches" }, ...branches.map((row) => ({ value: row.id, label: row.name }))],
            },
          ]}
        />
      ) : null}

      {deliveries.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {deliveries.map((delivery) => {
              const state = DELIVERY_STATES[delivery.status] ?? { label: delivery.status, tone: "" };
              const wait = waitingSince(delivery.assignedAt ?? delivery.createdAt);
              return (
                <li key={delivery.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/deliveries/${delivery.id}`} className="font-mono text-label-bold text-on-surface hover:underline">
                        {delivery.order?.orderNumber ?? "Order"}
                      </Link>
                      <Chip tone={state.tone}>{state.label}</Chip>
                    </p>
                    <p className="mt-1 text-body-md text-on-surface">
                      {delivery.driver?.user?.name ?? "No driver yet"}
                      {delivery.order?.addressSnapshot?.city ? ` · ${delivery.order.addressSnapshot.city}` : ""}
                    </p>
                    <p className="text-body-md text-on-surface-variant">
                      {branches.length > 1 ? `${branchName[delivery.order?.branchId] ?? "Another branch"} · ` : ""}
                      <span className={wait.tone}>{wait.label}</span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>

          {cursor || page.nextCursor ? (
            <div className="flex flex-wrap gap-2">
              {cursor ? (
                <Link href={href({ cursor: "" })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">
                  Oldest first
                </Link>
              ) : null}
              {page.nextCursor ? (
                <Link href={href({ cursor: page.nextCursor })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">
                  More
                </Link>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState icon={Bike} title={status ? "Nothing at this stage" : "No deliveries yet"}>
          {status ? "Try another tab." : "A delivery job is created when an order is ready to leave, not when it is placed."}
        </EmptyState>
      )}
    </div>
  );
}
