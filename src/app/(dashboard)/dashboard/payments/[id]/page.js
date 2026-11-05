import Link from "next/link";
import { requireReachable } from "@/lib/api/page";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import PaymentActions from "@/components/dashboard/finance/PaymentActions";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getPayment } from "@/server/services/payment.service";
import { assertRecordAccess } from "@/server/finance/access";
import { openDrawers, userNames } from "@/server/content/finance-admin";
import { refundWindowFor } from "@/server/services/refund.service";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { PAYMENT_STATES, REFUND_STATES, methodLabel, refundableAmount, timeLabel } from "@/lib/finance";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Payment — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * One payment in full.
 *
 * The provider's own identifiers are shown rather than hidden behind a
 * "technical details" fold. When a customer says the money left their account
 * and the system says the payment failed, the provider's reference is the
 * only thing that resolves it, and the person on the phone needs it in front
 * of them.
 */
export default async function PaymentPage({ params }) {
  const principal = await getAuthContext();
  const { id } = await params;
  if (!principal) redirect(loginHref(`/dashboard/payments/${id}`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "payments.read")) redirect("/dashboard");

  // Whose payment this is, before any of it is read.
  await requireReachable(assertRecordAccess(principal, "payment", id, "payments.read"));

  const payment = serialize(
    await requireReachable(getPayment(id)));
  const state = PAYMENT_STATES[payment.status] ?? { label: payment.status, tone: "", note: "" };
  const [{ currency }, drawers, names] = await Promise.all([
    getSiteIdentity(),
    payment.status === "PENDING" ? openDrawers(principal, { branchId: payment.branchId }) : [],
    userNames([payment.collectedById]),
  ]);

  const permissionsFor = {
    capture: can(principal, "payments.capture", { branchId: payment.branchId }),
    collect: can(principal, "payments.mark_collected", { branchId: payment.branchId }),
    void: can(principal, "payments.void", { branchId: payment.branchId }),
    requestRefund: can(principal, "refunds.request", { branchId: payment.branchId }),
  };

  const facts = [
    ["Method", methodLabel(payment.method) + (payment.cardLast4 ? ` ····${payment.cardLast4}` : "")],
    ["Provider", payment.provider ?? "—"],
    ["Started", timeLabel(payment.createdAt)],
    ["Authorised", timeLabel(payment.authorizedAt)],
    ["Captured", timeLabel(payment.capturedAt)],
    ["Failed", timeLabel(payment.failedAt)],
    ["Provider reference", payment.providerPaymentId ?? "—"],
    ["Provider order", payment.providerOrderId ?? "—"],
    ["Taken by", names[payment.collectedById] ?? "—"],
  ].filter(([, value]) => value && value !== "—");

  const refundWindow = refundWindowFor(payment);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={formatMoney(payment.amount, payment.currency ?? currency)}
        description={state.note}
        back={{ href: "/dashboard/payments", label: "Payments" }}
        actions={<Chip tone={state.tone}>{state.label}</Chip>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5 lg:col-span-2">
          <h2 className="font-display text-headline-md text-on-surface">What happened</h2>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {facts.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-label-bold text-on-surface-variant">{label}</dt>
                <dd className="break-words text-body-md text-on-surface">{value}</dd>
              </div>
            ))}
          </dl>

          {payment.failureMessage ? (
            <p className="rounded-field bg-error-container px-4 py-3 text-body-md text-on-error-container">
              {payment.failureMessage}
              {payment.failureCode ? ` (${payment.failureCode})` : ""}
            </p>
          ) : null}

          {Number(payment.feeAmount) > 0 ? (
            <p className="text-body-md text-on-surface-variant">
              The provider kept {formatMoney(payment.feeAmount, payment.currency ?? currency)} in fees, so{" "}
              {formatMoney(Number(payment.amount) - Number(payment.feeAmount), payment.currency ?? currency)} settles
              to the bank.
            </p>
          ) : null}
        </section>

        <section className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">The order</h2>
          {payment.order ? (
            <>
              <Link href={`/dashboard/orders/${payment.orderId}`} className="font-mono text-label-bold text-on-surface hover:underline">
                {payment.order.orderNumber}
              </Link>
              <p className="text-body-md text-on-surface-variant">
                Order total {formatMoney(payment.order.grandTotal, currency)}
                {payment.order.paymentState ? ` · ${payment.order.paymentState.toLowerCase().replace(/_/g, " ")}` : ""}
              </p>
            </>
          ) : (
            <p className="text-body-md text-on-surface-variant">The order behind this payment is gone.</p>
          )}
        </section>
      </div>

      {payment.refunds?.length ? (
        <section className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">Refunds against this payment</h2>
          <ul className="flex flex-col gap-2">
            {payment.refunds.map((refund) => {
              const refundState = REFUND_STATES[refund.status] ?? { label: refund.status, tone: "" };
              return (
                <li key={refund.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low px-4 py-3">
                  <span className="min-w-0">
                    <Link href={`/dashboard/refunds/${refund.id}`} className="text-label-bold text-on-surface hover:underline">
                      {formatMoney(refund.amount, payment.currency ?? currency)}
                    </Link>
                    <span className="block text-body-md text-on-surface-variant">{refund.reason ?? "No reason recorded"}</span>
                  </span>
                  <Chip tone={refundState.tone}>{refundState.label}</Chip>
                </li>
              );
            })}
          </ul>
          <p className="text-body-md text-on-surface-variant">
            {formatMoney(refundableAmount(payment), payment.currency ?? currency)} of this payment can still go back.
          </p>
        </section>
      ) : null}

      {/*
        * How long the gateway will still accept a refund.
        *
        * Shown before anyone tries, because the limit lives at the gateway: a
        * refund approved past it fails there, after the customer has already
        * been told the money is coming. Silent while there is plenty of time
        * — a countdown on every payment is noise that teaches people to
        * ignore it — and loud in the last fortnight.
        */}
      {refundWindow.lapsesAt && !refundWindow.allowed ? (
        <p className="rounded-card bg-error-container px-5 py-4 text-body-md text-on-error-container">
          This payment can no longer be refunded through {payment.provider}. {refundWindow.reason}. Pay the customer
          back in cash or by transfer, and record it as an expense so the books still balance.
        </p>
      ) : refundWindow.daysLeft != null && refundWindow.daysLeft <= 14 ? (
        <p className="rounded-card bg-surface-container px-5 py-4 text-body-md text-on-surface">
          {refundWindow.daysLeft === 1
            ? `Today is the last day ${payment.provider} will accept a refund on this payment.`
            : `${refundWindow.daysLeft} days left to refund this through ${payment.provider} — until ${refundWindow.lapsesAt.toISOString().slice(0, 10)}.`}{" "}
          After that it has to be settled by hand.
        </p>
      ) : null}

      <section className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
        <h2 className="font-display text-headline-md text-on-surface">What you can do</h2>
        <PaymentActions payment={payment} sessions={serialize(drawers)} currency={payment.currency ?? currency} can={permissionsFor} />
      </section>
    </div>
  );
}
