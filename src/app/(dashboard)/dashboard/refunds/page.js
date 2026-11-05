import Link from "next/link";
import { redirect } from "next/navigation";
import { Undo2 } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import StatTile from "@/components/dashboard/StatTile";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listRefunds } from "@/server/services/refund.service";
import { refundCounts, scopedBranches, waitingOnSomeone } from "@/server/content/finance-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { REFUND_FILTERS, REFUND_STATES, methodLabel, needsChasing, timeLabel } from "@/lib/finance";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Refunds — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/**
 * Money out.
 *
 * Failed refunds are called out above the list rather than left among the
 * completed ones. A failed refund is the worst state in this section: the
 * customer has been told they are getting their money back, the provider has
 * refused, and nothing retries on its own. In a list sorted by date it looks
 * finished.
 */
export default async function RefundsPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/refunds"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "refunds.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const scope = branchScope(principal, "refunds.read");

  const [counts, branches, { currency }, waiting] = await Promise.all([
    refundCounts(principal),
    scopedBranches(principal, "refunds.read"),
    getSiteIdentity(),
    waitingOnSomeone(principal),
  ]);

  const requested = one(params.status);
  const known = REFUND_FILTERS.some((row) => row.value === requested);
  const status = known ? requested : counts.REQUESTED ? "REQUESTED" : "";
  const branch = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : "";
  const cursor = one(params.cursor) || undefined;

  const page = await listRefunds({
    ...(status ? { status } : {}),
    ...(branch ? { branchId: branch } : {}),
    scope,
    limit: PAGE_SIZE,
    cursor,
  }).catch((error) => {
    if (cursor) return listRefunds({ scope, limit: PAGE_SIZE });
    throw error;
  });

  const refunds = serialize(page.items);

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { status, branch, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    if (values.status === "") query.set("status", "");
    const text = query.toString();
    return text ? `/dashboard/refunds?${text}` : "/dashboard/refunds";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Refunds"
        description="Money going back to customers. Every refund is requested by one person and approved by another — that separation is the only check there is on money leaving the business."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {waiting.refunds?.count ? (
          <StatTile
            label="Waiting for a decision"
            value={formatMoney(waiting.refunds.amount, currency)}
            note={`${waiting.refunds.count} ${waiting.refunds.count === 1 ? "request" : "requests"}. Nobody has been refunded yet.`}
          />
        ) : null}
        {counts.FAILED ? (
          <StatTile
            label="Failed and not retried"
            value={String(counts.FAILED)}
            note="The provider refused these. The customers were told they would be refunded and have not been."
            tone="inverse"
          />
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by state">
        {REFUND_FILTERS.map((tab) => {
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
          id="refunds"
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

      {refunds.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {refunds.map((refund) => {
              const state = REFUND_STATES[refund.status] ?? { label: refund.status, tone: "" };
              return (
                <li
                  key={refund.id}
                  className={`flex flex-wrap items-start justify-between gap-3 rounded-card p-5 ${needsChasing(refund) ? "bg-error-container/40" : "bg-surface-container-lowest"}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/refunds/${refund.id}`} className="font-mono text-label-bold text-on-surface hover:underline">
                        {refund.order?.orderNumber ?? "Refund"}
                      </Link>
                      <Chip tone={state.tone}>{state.label}</Chip>
                    </p>
                    <p className="mt-1 text-body-md text-on-surface">{refund.reason ?? "No reason recorded"}</p>
                    <p className="text-body-md text-on-surface-variant">
                      {methodLabel(refund.payment?.method)} · requested {timeLabel(refund.createdAt)}
                    </p>
                  </div>
                  <p className="tabular-nums text-body-md text-on-surface">{formatMoney(refund.amount, currency)}</p>
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
        <EmptyState icon={Undo2} title={status ? "Nothing in this state" : "No refunds"}>
          {status ? "Try another tab." : "A refund starts from a payment, so the request is made on the payment itself."}
        </EmptyState>
      )}
    </div>
  );
}
