import Link from "next/link";
import { nullIfMissing } from "@/lib/api/errors";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import PayoutActions from "@/components/dashboard/delivery/PayoutActions";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { inScope } from "@/server/access/scope";
import { serialize } from "@/lib/api/serialize";
import { getPayout } from "@/server/services/driver-payout.service";
import { recordBranches } from "@/server/delivery/access";
import { userNames } from "@/server/content/delivery-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { PAYOUT_STAGE_HINT, PAYOUT_STATES, dayKey, payoutBreakdown } from "@/lib/delivery";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Driver payout — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * One payout, shown as its parts.
 *
 * Earnings, tips, adjustment and the cash deduction are listed separately and
 * add up on screen to the stored total. A single net figure is a number
 * somebody has to take on trust; four numbers that reconcile are a number
 * they can check — and a driver querying their pay is exactly who is reading
 * this over somebody's shoulder.
 */
export default async function DriverPayoutPage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/driver-payouts/${id}`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "driver_payouts.read")) redirect("/dashboard");

  const raw = await nullIfMissing(getPayout(id));
  if (!raw) notFound();

  // A payout reaches a branch only through its driver, so that is the path
  // the check has to take rather than a `branchId` the table does not have.
  const [branchId] = await recordBranches("driverPayout", id).catch(() => [null]);
  if (!inScope(branchScope(principal, "driver_payouts.read"), branchId)) notFound();

  const payout = serialize(raw);
  const [{ currency }, names] = await Promise.all([getSiteIdentity(), userNames([payout.approvedById])]);

  const state = PAYOUT_STATES[payout.status] ?? { label: payout.status, tone: "" };
  const parts = payoutBreakdown(payout);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={payout.driver?.user?.name ?? "Driver payout"}
        description={`${dayKey(payout.periodStart)} to ${dayKey(payout.periodEnd)} · ${payout.deliveriesCount} ${payout.deliveriesCount === 1 ? "delivery" : "deliveries"}`}
        back={{ href: "/dashboard/driver-payouts", label: "Driver payouts" }}
        actions={<Chip tone={state.tone}>{state.label}</Chip>}
      />

      <p className="rounded-card bg-surface-container-lowest px-5 py-4 text-body-md text-on-surface-variant">
        {PAYOUT_STAGE_HINT[payout.status]}
      </p>

      <PayoutActions
        payout={payout}
        currency={currency}
        canApprove={can(principal, "driver_payouts.approve", { branchId })}
        canMarkPaid={can(principal, "driver_payouts.mark_paid", { branchId })}
      />

      <Section title="How it adds up">
        <dl className="grid gap-2 text-body-md">
          <div className="flex justify-between gap-4">
            <dt className="text-on-surface-variant">Delivery earnings</dt>
            <dd className="tabular-nums text-on-surface">{formatMoney(payout.earningsAmount, currency)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-on-surface-variant">Tips</dt>
            <dd className="tabular-nums text-on-surface">{formatMoney(payout.tipsAmount, currency)}</dd>
          </div>
          {Number(payout.adjustmentAmount) !== 0 ? (
            <div className="flex justify-between gap-4">
              <dt className="text-on-surface-variant">Adjustment</dt>
              <dd className="tabular-nums text-on-surface">{formatMoney(payout.adjustmentAmount, currency)}</dd>
            </div>
          ) : null}
          {Number(payout.codDeduction) !== 0 ? (
            <div className="flex justify-between gap-4">
              <dt className="text-on-surface-variant">Our cash they were holding</dt>
              <dd className="tabular-nums text-on-surface">−{formatMoney(payout.codDeduction, currency)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4 border-t border-outline-variant pt-2">
            <dt className="text-label-bold text-on-surface">Paid to them</dt>
            <dd className={`text-label-bold tabular-nums ${Number(payout.netAmount) < 0 ? "text-error" : "text-on-surface"}`}>
              {formatMoney(payout.netAmount, currency)}
            </dd>
          </div>
        </dl>

        {/* If the parts do not reconstruct the stored total, say so rather
            than letting two different numbers sit on one page unexplained. */}
        {parts.disagrees ? (
          <p className="rounded-field bg-warning-container px-4 py-3 text-body-md text-on-warning-container">
            These lines come to {formatMoney(parts.expected, currency)}, which is not the stored total. Something has
            changed since this was worked out — cancel it and generate it again.
          </p>
        ) : null}

        {payout.paidAt ? (
          <p className="text-body-md text-on-surface-variant">
            Paid {dayKey(payout.paidAt)}
            {payout.paymentReference ? ` · ${payout.paymentReference}` : ""}
          </p>
        ) : null}
        {names[payout.approvedById] ? (
          <p className="text-body-md text-on-surface-variant">Approved by {names[payout.approvedById]}.</p>
        ) : null}
      </Section>

      <Section title="What is in it">
        {payout.lines?.length ? (
          <ul className="flex flex-col gap-2">
            {payout.lines.map((line) => (
              <li key={line.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low px-4 py-3">
                <span className="min-w-0 text-body-md text-on-surface">
                  {hasPermission(permissions, "deliveries.read") && line.deliveryId ? (
                    <Link href={`/dashboard/deliveries/${line.deliveryId}`} className="hover:underline">
                      {line.label ?? "A delivery"}
                    </Link>
                  ) : (
                    (line.label ?? "A delivery")
                  )}
                </span>
                <span className="tabular-nums text-body-md text-on-surface">{formatMoney(line.amount, currency)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body-md text-on-surface-variant">
            No delivery lines. Only delivered jobs count — a failed or cancelled one earns nothing, because paying for
            one would make cancelling attractive.
          </p>
        )}
      </Section>
    </div>
  );
}
