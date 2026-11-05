import Link from "next/link";
import { redirect } from "next/navigation";
import { Ticket } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import StatTile from "@/components/dashboard/StatTile";
import CouponTools from "@/components/dashboard/marketing/CouponTools";
import RevokeCampaign from "@/components/dashboard/marketing/RevokeCampaign";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listCoupons } from "@/server/services/coupon.service";
import { campaignTags, promotionOptions } from "@/server/content/marketing-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { dateLabel } from "@/lib/finance";
import { couponState, discountSummary, isHardToRead, usageSummary } from "@/lib/marketing";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Coupons — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * The codes that unlock an offer.
 *
 * A code is a bearer token: whoever has it can spend it. That shapes two
 * things here — the list is cut to the viewer's branches like any other
 * record carrying value, and a batch can be revoked as a unit, because the
 * moment you need that is the moment a print run has leaked and revoking
 * ten thousand codes one at a time is not a plan.
 */
export default async function CouponsPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/coupons"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "coupons.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const scope = branchScope(principal, "coupons.read");

  const [promotions, campaigns, { currency, timeZone }] = await Promise.all([
    promotionOptions(principal),
    campaignTags(principal),
    getSiteIdentity(),
  ]);

  const promotion = promotions.some((row) => row.id === one(params.promotion)) ? one(params.promotion) : "";
  const campaign = campaigns.some((row) => row.campaign === one(params.campaign)) ? one(params.campaign) : "";
  const search = (one(params.q) ?? "").trim();
  const cursor = one(params.cursor) || undefined;

  const page = await listCoupons({
    ...(promotion ? { promotionId: promotion } : {}),
    ...(campaign ? { campaign } : {}),
    ...(search ? { search } : {}),
    scope,
    limit: PAGE_SIZE,
    cursor,
  }).catch((error) => {
    if (cursor) return listCoupons({ scope, limit: PAGE_SIZE });
    throw error;
  });

  const now = new Date();
  const coupons = serialize(page.items);
  const live = coupons.filter((coupon) => couponState(coupon, now).key === "live").length;
  const redeemed = coupons.reduce((sum, coupon) => sum + (coupon.redemptionCount ?? 0), 0);
  const selectedCampaign = campaigns.find((row) => row.campaign === campaign);

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { promotion, campaign, q: search, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    const text = query.toString();
    return text ? `/dashboard/coupons?${text}` : "/dashboard/coupons";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Coupons"
        description="Codes that unlock an offer. Anyone holding one can use it, so treat a list of them the way you would a stack of vouchers."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile label="Usable now" value={String(live)} note={`Of ${coupons.length} shown.`} />
        <StatTile label="Redeemed" value={String(redeemed)} note="Times these codes have been used." />
        {campaigns.length ? <StatTile label="Batches" value={String(campaigns.length)} note="Named runs that can be revoked together." /> : null}
      </div>

      <CouponTools
        promotions={serialize(promotions)}
        defaultPromotionId={promotion}
        canCreate={hasPermission(permissions, "coupons.create")}
        canGenerate={hasPermission(permissions, "coupons.generate_bulk")}
      />

      <ListFilters
        id="coupons"
        fields={[
          { type: "search", name: "q", label: "Find a code", value: search, placeholder: "SAVE20" },
          {
            type: "select",
            name: "promotion",
            label: "Offer",
            value: promotion,
            options: [{ value: "", label: "Any offer" }, ...promotions.map((row) => ({ value: row.id, label: row.name }))],
          },
          ...(campaigns.length
            ? [
                {
                  type: "select",
                  name: "campaign",
                  label: "Batch",
                  value: campaign,
                  options: [
                    { value: "", label: "Any batch" },
                    ...campaigns.map((row) => ({ value: row.campaign, label: `${row.campaign} (${row.count})` })),
                  ],
                },
              ]
            : []),
        ]}
      />

      {selectedCampaign && hasPermission(permissions, "coupons.update") ? (
        <section className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">The batch &ldquo;{selectedCampaign.campaign}&rdquo;</h2>
          <RevokeCampaign campaign={selectedCampaign.campaign} count={selectedCampaign.count} />
        </section>
      ) : null}

      {coupons.length ? (
        <>
          <ul className="flex flex-col gap-2">
            {coupons.map((coupon) => {
              const state = couponState(coupon, now);
              const usage = usageSummary({ used: coupon.redemptionCount, limit: coupon.maxRedemptions });

              return (
                <li key={coupon.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-4">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-label-bold text-on-surface">{coupon.code}</span>
                      <Chip tone={state.tone}>{state.label}</Chip>
                      {coupon.assignedToId ? <Chip tone="bg-secondary-container text-on-secondary-container">Personal</Chip> : null}
                      {isHardToRead(coupon.code) ? <Chip>Hard to read aloud</Chip> : null}
                    </p>
                    <p className="mt-1 text-body-md text-on-surface-variant">
                      {coupon.promotion ? discountSummary(coupon.promotion, { currency, formatMoney }) : "No offer behind it"}
                      {coupon.campaign ? ` · ${coupon.campaign}` : ""}
                      {coupon.expiresAt ? ` · expires ${dateLabel(coupon.expiresAt, timeZone)}` : ""}
                    </p>
                  </div>
                  <p className="tabular-nums text-body-md text-on-surface">{usage.label}</p>
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
        <EmptyState icon={Ticket} title={promotion || campaign || search ? "Nothing matches" : "No codes yet"}>
          {promotion || campaign || search
            ? "Try a wider filter."
            : "A code unlocks an offer that is marked as needing one. Build the offer first, then make codes for it."}
        </EmptyState>
      )}
    </div>
  );
}
