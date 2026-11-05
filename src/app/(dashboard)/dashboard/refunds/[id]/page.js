import Link from "next/link";
import { requireReachable } from "@/lib/api/page";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import ActionButton from "@/components/dashboard/inventory/ActionButton";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getRefund } from "@/server/services/refund.service";
import { assertRecordAccess, recordBranches } from "@/server/finance/access";
import { userNames } from "@/server/content/finance-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { REFUND_STATES, awaitingDecision, methodLabel, needsChasing, timeLabel } from "@/lib/finance";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Refund — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * One refund, and the decision it is waiting for.
 *
 * Approving is the moment money actually leaves, so the button says so in
 * those words. "Approve" on its own reads like agreeing with a colleague;
 * what it does is send a payment instruction to a provider that cannot be
 * recalled.
 */
export default async function RefundPage({ params }) {
  const principal = await getAuthContext();
  const { id } = await params;
  if (!principal) redirect(loginHref(`/dashboard/refunds/${id}`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "refunds.read")) redirect("/dashboard");

  await requireReachable(assertRecordAccess(principal, "refund", id, "refunds.read"));

  const refund = serialize(
    await requireReachable(getRefund(id)));
  const [branchId] = await recordBranches("refund", id);
  const state = REFUND_STATES[refund.status] ?? { label: refund.status, tone: "", note: "" };
  const [{ currency }, names] = await Promise.all([
    getSiteIdentity(),
    userNames([refund.requestedById, refund.approvedById]),
  ]);

  const canApprove = can(principal, "refunds.approve", { branchId });
  const canReject = can(principal, "refunds.reject", { branchId });
  const pending = awaitingDecision(refund);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={formatMoney(refund.amount, currency)}
        description={state.note}
        back={{ href: "/dashboard/refunds", label: "Refunds" }}
        actions={<Chip tone={state.tone}>{state.label}</Chip>}
      />

      {needsChasing(refund) ? (
        <p role="status" className="rounded-card bg-error-container px-5 py-4 text-body-md text-on-error-container">
          The provider refused this refund{refund.failureMessage ? `: ${refund.failureMessage}` : "."} The customer has
          been told they are getting their money back and has not been paid. Nothing will retry on its own.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5 lg:col-span-2">
          <h2 className="font-display text-headline-md text-on-surface">Why</h2>
          <p className="text-body-md text-on-surface">{refund.reason ?? "No reason was recorded."}</p>

          <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {[
              ["Requested", timeLabel(refund.createdAt)],
              ["Requested by", names[refund.requestedById] ?? "—"],
              ["Approved", timeLabel(refund.approvedAt)],
              ["Approved by", names[refund.approvedById] ?? "—"],
              ["Sent to provider", timeLabel(refund.processedAt)],
              ["Provider reference", refund.providerRefundId ?? "—"],
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
          <h2 className="font-display text-headline-md text-on-surface">Against</h2>
          {refund.order ? (
            <Link href={`/dashboard/orders/${refund.orderId}`} className="font-mono text-label-bold text-on-surface hover:underline">
              {refund.order.orderNumber}
            </Link>
          ) : null}
          {refund.payment ? (
            <p className="text-body-md text-on-surface-variant">
              <Link href={`/dashboard/payments/${refund.paymentId}`} className="hover:underline">
                {methodLabel(refund.payment.method)} payment of {formatMoney(refund.payment.amount, currency)}
              </Link>
            </p>
          ) : null}
        </section>
      </div>

      {pending && (canApprove || canReject) ? (
        <section className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
          <div>
            <h2 className="font-display text-headline-md text-on-surface">Decide</h2>
            <p className="mt-1 text-body-md text-on-surface-variant">
              Approving sends the instruction to the provider immediately. It cannot be recalled from here.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {canApprove ? (
              <ActionButton
                endpoint={`/admin/refunds/${refund.id}/approve`}
                confirm={`Send ${formatMoney(refund.amount, currency)} back to the customer? This cannot be undone.`}
                success="Approved and sent."
                tone="primary"
              >
                Approve and refund the money
              </ActionButton>
            ) : null}
            {canReject ? (
              <ActionButton
                endpoint={`/admin/refunds/${refund.id}/reject`}
                confirm="Turn this request down? No money moves."
                success="Rejected."
                tone="danger"
              >
                Turn it down
              </ActionButton>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
