import Link from "next/link";
import { redirect } from "next/navigation";
import { Wallet } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import StatTile from "@/components/dashboard/StatTile";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import EarningActions from "@/components/dashboard/creator/EarningActions";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { earningsSummary, listEarnings } from "@/server/services/creator-earning.service";
import { branchNames, earningCounts, programLimits, scopedBranches } from "@/server/content/creator-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { dateLabel } from "@/lib/finance";
import {
  EARNING_FILTERS,
  chipClass,
  costVerdict,
  disqualificationHint,
  earningState,
  holdProgress,
} from "@/lib/creator";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Creator earnings — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/**
 * What the programme has paid, and what it is about to.
 *
 * Two things here are deliberately not hidden.
 *
 * **Sales that earned nothing are in the list.** A `NOT_QUALIFIED` row means
 * a video drove a real sale and no rule covered it — which is either a rule
 * worth writing or a threshold worth lowering, and it is invisible if the
 * table only shows money that moved.
 *
 * **Cost of sales gets a verdict, not just a percentage.** It is the number
 * that decides whether the programme continues, and a bare "11.4%" leaves
 * everyone to invent their own view of whether that is good.
 */
export default async function CreatorEarningsPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/creator-earnings"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "creator_earnings.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const scope = branchScope(principal, "creator_earnings.read");

  const branches = await scopedBranches(principal, "creator_earnings.read");
  const status = EARNING_FILTERS.some((row) => row.value === one(params.status)) ? one(params.status) : "";
  const branchId = branches.some((branch) => branch.id === one(params.branchId)) ? one(params.branchId) : "";
  const cursor = one(params.cursor) || undefined;

  const [counts, summary, limits, { currency, timeZone }] = await Promise.all([
    earningCounts(principal, { branchId: branchId || null }),
    earningsSummary({ scope, branchId: branchId || null }),
    programLimits(),
    getSiteIdentity(),
  ]);

  const page = await listEarnings({
    ...(status ? { status } : {}),
    ...(branchId ? { branchId } : {}),
    scope,
    limit: PAGE_SIZE,
    cursor,
  }).catch((error) => {
    if (cursor) return listEarnings({ scope, limit: PAGE_SIZE });
    throw error;
  });

  const earnings = serialize(page.items);
  const names = await branchNames(earnings.map((earning) => earning.order?.branchId));
  const money = (value) => formatMoney(value, currency);
  const verdict = costVerdict(summary.attributedRevenue > 0 ? summary.costOfSalesPercent : null);
  const canReverse = hasPermission(permissions, "creator_earnings.reverse");
  const now = new Date();

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { status, branchId, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    const text = query.toString();
    return text ? `/dashboard/creator-earnings?${text}` : "/dashboard/creator-earnings";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Creator earnings"
        description={`One row per attributed line on a completed order. Credit holds for ${limits.earningHoldDays} days after the order completes, so a refund in that window takes it back before it is ever paid.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Paid out" value={money(summary.creditedTotal)} note="Credit that reached a wallet" />
        <StatTile
          label="Revenue driven"
          value={money(summary.attributedRevenue)}
          note={`${summary.attributedOrders} attributed ${summary.attributedOrders === 1 ? "sale" : "sales"}`}
        />
        <StatTile
          label="Cost of sales"
          value={summary.attributedRevenue > 0 ? `${summary.costOfSalesPercent}%` : "—"}
          note={verdict.sentence}
        />
        <StatTile
          label="Holding"
          value={money(summary.byStatus?.PENDING?.amount ?? 0)}
          note={`${summary.byStatus?.PENDING?.count ?? 0} inside the refund window`}
        />
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by state">
        {EARNING_FILTERS.map((tab) => (
          <Link
            key={tab.label}
            href={href({ status: tab.value, cursor: "" })}
            aria-current={status === tab.value ? "page" : undefined}
            className={`rounded-field px-4 py-2.5 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${status === tab.value ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
          >
            {tab.label}
            <span className="ml-2 font-normal tabular-nums opacity-80">{counts[tab.value || "all"] ?? 0}</span>
          </Link>
        ))}
      </div>

      {branches.length > 1 ? (
        <ListFilters
          id="creator-earnings"
          hidden={{ status: status || null }}
          fields={[
            {
              type: "select",
              name: "branchId",
              label: "Branch",
              value: branchId,
              options: [
                { value: "", label: "Every branch you cover" },
                ...branches.map((branch) => ({ value: branch.id, label: branch.name })),
              ],
            },
          ]}
        />
      ) : null}

      {earnings.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {earnings.map((earning) => {
              const state = earningState(earning);
              const hold = holdProgress(earning, now);
              const branch = earning.order?.branchId ? names[earning.order.branchId] : null;

              return (
                <li key={earning.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-label-bold text-on-surface">{earning.creator?.displayName ?? "A creator"}</span>
                      <span className="font-mono text-body-md text-on-surface-variant">@{earning.creator?.handle}</span>
                      <Chip tone={chipClass(state.tone)}>{state.label}</Chip>
                    </p>
                    <p className="mt-1 text-body-md text-on-surface-variant">
                      Order {earning.order?.orderNumber ?? "—"}
                      {branch ? ` at ${branch}` : ""}
                      {earning.orderCompletedAt ? ` · completed ${dateLabel(earning.orderCompletedAt, timeZone)}` : ""}
                    </p>
                    <p className="text-body-md text-on-surface-variant">
                      {earning.ruleNameSnapshot
                        ? `Paid under “${earning.ruleNameSnapshot}” on ${money(earning.basisAmount)}`
                        : disqualificationHint(earning.disqualifiedReason)}
                    </p>
                    {hold ? <p className="mt-1 text-body-md text-on-surface-variant">{hold.sentence}</p> : null}
                    {earning.reversalReason ? (
                      <p className="mt-1 text-body-md text-error">Clawed back: {earning.reversalReason}</p>
                    ) : null}

                    <EarningActions earning={earning} can={canReverse} />
                  </div>
                  <div className="text-right">
                    <p className="tabular-nums text-body-md text-on-surface">
                      {earning.status === "NOT_QUALIFIED" ? "nothing" : money(earning.amount)}
                    </p>
                    <p className="text-label-bold font-normal text-on-surface-variant">{state.note}</p>
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
        <EmptyState icon={Wallet} title={status || branchId ? "Nothing matches" : "No earnings yet"}>
          {status || branchId
            ? "Try another tab or a different branch."
            : "An earning appears when an order a video is credited with completes."}
        </EmptyState>
      )}
    </div>
  );
}
