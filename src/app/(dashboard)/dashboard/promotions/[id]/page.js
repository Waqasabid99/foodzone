import Link from "next/link";
import { requireReachable } from "@/lib/api/page";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import ActionButton from "@/components/dashboard/inventory/ActionButton";
import PromotionForm from "@/components/dashboard/marketing/PromotionForm";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys, holdsCompanyWide } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getPromotion } from "@/server/services/promotion.service";
import { assertPromotionAccess, reachesPromotion } from "@/server/marketing/access";
import { actionableBranches, branchNames, targetNames, userNames } from "@/server/content/marketing-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { dateLabel } from "@/lib/finance";
import { conditionList, discountSummary, promotionState, reachSummary, scheduleSummary, usageSummary } from "@/lib/marketing";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Offer — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * One offer, and whether it is actually doing anything.
 *
 * The state line is the point of the page. An offer can be switched on and
 * still be inert — out of date, out of redemptions, waiting to start, or
 * pinned to a branch that no longer exists — and all five look identical in
 * a list.
 */
export default async function PromotionPage({ params }) {
  const principal = await getAuthContext();
  const { id } = await params;
  if (!principal) redirect(loginHref(`/dashboard/promotions/${id}`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "promotions.read")) redirect("/dashboard");

  await requireReachable(assertPromotionAccess(principal, id, "promotions.read"));

  const promotion = serialize(
    await requireReachable(getPromotion(id)));
  const [{ currency }, names, targets, people, branches] = await Promise.all([
    getSiteIdentity(),
    branchNames([promotion.branchIds]),
    targetNames(promotion.targets ?? []),
    userNames([promotion.createdById]),
    actionableBranches(principal, "promotions.update"),
  ]);

  const now = new Date();
  const state = promotionState(promotion, now);
  const reach = reachSummary(promotion, names);
  const usage = usageSummary({ used: promotion.usageCount, limit: promotion.usageLimit });
  const conditions = conditionList(promotion, { currency, formatMoney });

  // Writing needs the reach as well as the permission: a chain-wide offer
  // takes a company-wide role, which is what the API will also insist on.
  const mayWrite =
    hasPermission(permissions, "promotions.update") &&
    reachesPromotion(principal, promotion.branchIds, "promotions.update") &&
    (promotion.branchIds?.length ? true : holdsCompanyWide(principal, "promotions.update"));
  const mayActivate = hasPermission(permissions, "promotions.activate") && mayWrite;
  const mayDelete = hasPermission(permissions, "promotions.delete") && mayWrite;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={promotion.name}
        description={state.note}
        back={{ href: "/dashboard/promotions", label: "Promotions" }}
        actions={
          <>
            <Chip tone={state.tone}>{state.label}</Chip>
            <Chip tone={reach.tone}>{reach.label}</Chip>
          </>
        }
      />

      {reach.dead ? (
        <p role="status" className="rounded-card bg-error-container px-5 py-4 text-body-md text-on-error-container">
          {reach.note} Either point it at a branch that exists or delete it.
        </p>
      ) : null}

      {promotion.requiresCoupon && !promotion._count?.coupons ? (
        <p role="status" className="rounded-card bg-warning-container px-5 py-4 text-body-md text-on-warning-container">
          This offer needs a code and no codes exist for it, so nothing can redeem it.{" "}
          <Link href={`/dashboard/coupons?promotion=${promotion.id}`} className="underline">
            Make one
          </Link>
          .
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5 lg:col-span-2">
          <h2 className="font-display text-headline-md text-on-surface">What it does</h2>
          <p className="text-body-md text-on-surface">{discountSummary(promotion, { currency, formatMoney })}</p>
          <p className="text-body-md text-on-surface-variant">{scheduleSummary(promotion, { dateLabel })}</p>
          {conditions.length ? (
            <ul className="flex flex-col gap-1 text-body-md text-on-surface-variant">
              {conditions.map((condition) => (
                <li key={condition}>· {condition}</li>
              ))}
            </ul>
          ) : null}
          {promotion.description ? <p className="text-body-md text-on-surface">{promotion.description}</p> : null}

          <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {[
              ["Channels", promotion.channels?.length ? promotion.channels.join(", ") : "Every channel"],
              ["Order types", promotion.orderTypes?.length ? promotion.orderTypes.join(", ") : "Every type"],
              ["Combines with others", promotion.isStackable ? "Yes" : "No — the higher priority wins"],
              ["Priority", String(promotion.priority ?? 0)],
              ["Built by", people[promotion.createdById] ?? "—"],
            ]
              .filter(([, value]) => value && value !== "—")
              .map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-label-bold text-on-surface-variant">{label}</dt>
                  <dd className="break-words text-body-md text-on-surface">{value}</dd>
                </div>
              ))}
          </dl>
        </section>

        <section className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">Take-up</h2>
          <p className="tabular-nums font-display text-headline-md text-on-surface">{usage.label}</p>
          {usage.percent != null ? (
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container-high">
              <div className="h-full rounded-full bg-chart-data" style={{ width: `${usage.percent}%` }} />
            </div>
          ) : null}
          <p className="text-body-md text-on-surface-variant">
            {promotion._count?.discounts ?? 0} {promotion._count?.discounts === 1 ? "order has" : "orders have"} had
            this applied.
          </p>
          {promotion._count?.coupons ? (
            <Link href={`/dashboard/coupons?promotion=${promotion.id}`} className="w-fit text-label-bold text-primary hover:underline">
              {promotion._count.coupons} {promotion._count.coupons === 1 ? "code" : "codes"} unlock it
            </Link>
          ) : null}
        </section>
      </div>

      {promotion.targets?.length ? (
        <section className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">What it applies to</h2>
          <ul className="flex flex-col gap-2">
            {promotion.targets.map((target) => (
              <li key={target.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low px-4 py-3">
                <span className="min-w-0 text-body-md text-on-surface">
                  {target.targetType === "ORDER"
                    ? "The whole order"
                    : (targetNamesOrId(targets, target))}
                  <span className="block text-label-bold font-normal text-on-surface-variant">
                    {target.targetType.toLowerCase()}
                    {target.role ? ` · the ${target.role === "BUY" ? "bought" : "free"} side` : ""}
                  </span>
                </span>
                {target.isExcluded ? <Chip tone="bg-error-container text-on-error-container">Excluded</Chip> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {mayActivate || mayDelete ? (
        <section className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">What you can do</h2>
          <div className="flex flex-wrap gap-3">
            {mayActivate ? (
              <ActionButton
                method="patch"
                endpoint={`/admin/promotions/${promotion.id}/active`}
                body={{ isActive: !promotion.isActive }}
                confirm={promotion.isActive ? "Pause this offer? It stops applying immediately." : null}
                success={promotion.isActive ? "Paused." : "Switched on."}
                tone={promotion.isActive ? "neutral" : "primary"}
              >
                {promotion.isActive ? "Pause it" : "Switch it on"}
              </ActionButton>
            ) : null}
            {mayDelete ? (
              <ActionButton
                method="delete"
                endpoint={`/admin/promotions/${promotion.id}`}
                confirm="Delete this offer? Orders that already used it keep their discount."
                success="Deleted."
                tone="danger"
                redirectTo="/dashboard/promotions"
              >
                Delete it
              </ActionButton>
            ) : null}
          </div>
          <p className="text-body-md text-on-surface-variant">
            Pausing stops it applying from now on. Orders that already took the discount are unaffected — the money
            came off at the time and the ledger says so.
          </p>
        </section>
      ) : null}

      {mayWrite ? (
        <section className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">Edit</h2>
          <PromotionForm
            promotion={promotion}
            branches={serialize(branches)}
            targetNames={targets}
            canGoChainWide={holdsCompanyWide(principal, "promotions.update")}
            currency={currency}
          />
        </section>
      ) : null}
    </div>
  );
}

/** A target's name, falling back to the raw id when the row has gone. */
function targetNamesOrId(names, target) {
  return names[target.targetId] ?? `Unknown ${target.targetType.toLowerCase()} (${target.targetId ?? "no id"})`;
}
