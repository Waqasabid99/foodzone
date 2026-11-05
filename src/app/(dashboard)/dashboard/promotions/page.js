import Link from "next/link";
import { redirect } from "next/navigation";
import { Percent, Plus } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys, holdsCompanyWide } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listPromotions } from "@/server/services/promotion.service";
import { branchNames, promotionCounts, scopedBranches } from "@/server/content/marketing-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { dateLabel } from "@/lib/finance";
import {
  DISCOUNT_TYPES,
  PROMOTION_FILTERS,
  conditionList,
  discountSummary,
  promotionState,
  reachSummary,
  scheduleSummary,
  usageSummary,
} from "@/lib/marketing";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Promotions — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/**
 * Every offer the restaurant is running, or thinks it is.
 *
 * The tabs are computed states, not an `isActive` column. "Paused",
 * "scheduled", "ended" and "used up" are four different reasons an offer is
 * not applying, and a toggle alone cannot tell somebody their campaign ran
 * out of redemptions on Tuesday.
 */
export default async function PromotionsPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/promotions"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "promotions.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const scope = branchScope(principal, "promotions.read");

  const [counts, branches, { currency }] = await Promise.all([
    promotionCounts(principal),
    scopedBranches(principal, "promotions.read"),
    getSiteIdentity(),
  ]);

  const state = PROMOTION_FILTERS.some((row) => row.value === one(params.state)) ? one(params.state) : "";
  const type = DISCOUNT_TYPES[one(params.type)] ? one(params.type) : "";
  const search = (one(params.q) ?? "").trim();
  const cursor = one(params.cursor) || undefined;

  // The computed states cannot be expressed as a `where`, so the server
  // filters on what it can and the state tab narrows what came back.
  const page = await listPromotions({
    ...(type ? { type } : {}),
    ...(search ? { search } : {}),
    ...(state === "paused" ? { isActive: false } : {}),
    scope,
    limit: PAGE_SIZE,
    cursor,
  }).catch((error) => {
    if (cursor) return listPromotions({ scope, limit: PAGE_SIZE });
    throw error;
  });

  const now = new Date();
  const all = serialize(page.items);
  const promotions = state ? all.filter((promotion) => promotionState(promotion, now).key === state) : all;
  const names = await branchNames(promotions.map((promotion) => promotion.branchIds));
  const canCreate = hasPermission(permissions, "promotions.create");

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { state, type, q: search, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    const text = query.toString();
    return text ? `/dashboard/promotions?${text}` : "/dashboard/promotions";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Promotions"
        description="The rules that take money off an order. An offer with no code applies by itself whenever something qualifies; one that needs a code does nothing until a coupon exists for it."
        actions={
          canCreate ? (
            <Link
              href="/dashboard/promotions/new"
              className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Plus aria-hidden="true" className="size-4" />
              New offer
            </Link>
          ) : null
        }
      />

      {!holdsCompanyWide(principal, "promotions.create") && canCreate ? (
        <p className="rounded-card bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant">
          Your permission is pinned to a branch, so you can build offers for your own outlets. A chain-wide offer —
          one with no branches named — runs everywhere including outlets opened later, and needs a company-wide role.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by state">
        {PROMOTION_FILTERS.map((tab) => (
          <Link
            key={tab.label}
            href={href({ state: tab.value, cursor: "" })}
            aria-current={state === tab.value ? "page" : undefined}
            className={`rounded-field px-4 py-2.5 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${state === tab.value ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
          >
            {tab.label}
            <span className="ml-2 font-normal tabular-nums opacity-80">{counts[tab.value || "all"] ?? 0}</span>
          </Link>
        ))}
      </div>

      <ListFilters
        id="promotions"
        hidden={{ state: state || null }}
        fields={[
          { type: "search", name: "q", label: "Find", value: search, placeholder: "An offer's name" },
          {
            type: "select",
            name: "type",
            label: "Kind",
            value: type,
            options: [{ value: "", label: "Any kind" }, ...Object.entries(DISCOUNT_TYPES).map(([value, row]) => ({ value, label: row.label }))],
          },
        ]}
      />

      {promotions.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {promotions.map((promotion) => {
              const live = promotionState(promotion, now);
              const reach = reachSummary(promotion, names);
              const usage = usageSummary({ used: promotion.usageCount, limit: promotion.usageLimit });
              const conditions = conditionList(promotion, { currency, formatMoney });

              return (
                <li key={promotion.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/promotions/${promotion.id}`} className="text-label-bold text-on-surface hover:underline">
                        {promotion.name}
                      </Link>
                      <Chip tone={live.tone}>{live.label}</Chip>
                      <Chip tone={reach.tone}>{reach.label}</Chip>
                    </p>
                    <p className="mt-1 text-body-md text-on-surface">{discountSummary(promotion, { currency, formatMoney })}</p>
                    <p className="text-body-md text-on-surface-variant">
                      {scheduleSummary(promotion, { dateLabel })}
                      {conditions.length ? ` · ${conditions.join(" · ")}` : ""}
                    </p>
                    {reach.note ? <p className="mt-1 text-body-md text-error">{reach.note}</p> : null}
                  </div>
                  <div className="text-right">
                    <p className="tabular-nums text-body-md text-on-surface">{usage.label}</p>
                    {promotion._count?.coupons ? (
                      <p className="text-label-bold font-normal text-on-surface-variant">
                        {promotion._count.coupons} {promotion._count.coupons === 1 ? "code" : "codes"}
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
          icon={Percent}
          title={state || type || search ? "Nothing matches" : "No offers yet"}
          action={canCreate ? { href: "/dashboard/promotions/new", label: "Build one" } : null}
        >
          {state || type || search ? "Try another tab or a wider search." : "An offer is a rule: what comes off, when, and for whom."}
        </EmptyState>
      )}
    </div>
  );
}
