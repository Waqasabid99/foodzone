"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";
import { isCash, paymentActions, refundableAmount } from "@/lib/finance";

/**
 * What can still be done to one payment.
 *
 * The buttons that appear are the ones that would actually work, decided by
 * `paymentActions`. Showing every action greyed out invites a click and then
 * explains why it was refused, which is a worse way of saying "not now" than
 * not offering it.
 *
 * **Capturing less than was authorised is allowed and is called out.** A card
 * authorisation reserves an amount; taking less is normal when an item is out
 * of stock, and taking more is impossible. The difference is released rather
 * than kept, which the customer's bank will show them, so the screen says it
 * here first.
 *
 * Refund is a *request*, never an immediate payout, even for someone who can
 * also approve. Money leaving the business is a two-step decision by design,
 * and collapsing it into one button for whoever happens to hold both
 * permissions removes the only check there is.
 */
export default function PaymentActions({ payment, sessions = [], currency, can }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? "");
  const [refund, setRefund] = useState({ open: false, amount: "", reason: "" });

  const available = paymentActions(payment).filter((action) => can[action.key]);
  const refundable = refundableAmount(payment);
  const canRefund = can.requestRefund && Number(refundable) > 0;

  async function run(path, body, { success, confirm }) {
    if (busy) return;
    if (confirm && !window.confirm(confirm)) return;

    setBusy(path);
    setError(null);
    try {
      await api.post(`/admin/payments/${payment.id}/${path}`, body ?? {});
      toast.success(success);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  async function requestRefund(event) {
    event.preventDefault();
    if (busy) return;

    const value = refund.amount.trim();
    if (value && Number(value) > Number(refundable)) {
      setError(`Only ${formatMoney(refundable, currency)} of this payment can still be refunded.`);
      return;
    }
    if (!refund.reason.trim()) {
      setError("Say why. A refund with no reason is impossible to answer a question about later.");
      return;
    }

    setBusy("refund");
    setError(null);
    try {
      await api.post("/admin/refunds", {
        paymentId: payment.id,
        ...(value ? { amount: Number(value) } : {}),
        reason: refund.reason.trim(),
      });
      toast.success("Refund requested. It needs approving before any money moves.");
      setRefund({ open: false, amount: "", reason: "" });
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  if (!available.length && !canRefund) {
    return (
      <p className="rounded-field bg-surface-container-low px-4 py-3 text-body-md text-on-surface-variant">
        Nothing left to do to this payment.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <FormAlert>{error}</FormAlert>

      {available.some((action) => action.key === "capture") ? (
        <div className="flex flex-col gap-3 rounded-field bg-surface-container-low p-4">
          <p className="text-label-bold text-on-surface">Capture the authorisation</p>
          <p className="text-body-md text-on-surface-variant">
            {formatMoney(payment.amount, currency)} is reserved on the card and has not been taken. Leave the box empty
            to take all of it.
          </p>
          <Field
            id="capture-amount"
            label="Take less than was authorised"
            type="number"
            step="0.01"
            min="0"
            max={String(payment.amount)}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            hint="The rest is released back to the customer's card, which their bank will show them."
            autoComplete="off"
          />
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() =>
              run("capture", amount.trim() ? { amount: Number(amount) } : {}, {
                success: "Captured.",
                confirm: amount.trim()
                  ? `Take ${formatMoney(amount, currency)} and release the rest of ${formatMoney(payment.amount, currency)}?`
                  : null,
              })
            }
            className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {busy === "capture" ? "Capturing…" : "Capture"}
          </button>
        </div>
      ) : null}

      {available.some((action) => action.key === "collect") ? (
        <div className="flex flex-col gap-3 rounded-field bg-surface-container-low p-4">
          <p className="text-label-bold text-on-surface">Mark the cash collected</p>
          <p className="text-body-md text-on-surface-variant">
            {isCash(payment.method) ? "Physical money" : "This payment"} of {formatMoney(payment.amount, currency)}.
            It lands in a drawer and becomes part of that shift&rsquo;s expected cash.
          </p>
          {sessions.length ? (
            <SelectField
              id="collect-session"
              label="Into which drawer"
              value={sessionId}
              onChange={(event) => setSessionId(event.target.value)}
              options={sessions.map((session) => ({
                value: session.id,
                label: `${session.registerName} — opened ${new Date(session.openedAt).toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}`,
              }))}
            />
          ) : (
            <p className="rounded-field bg-warning-container px-3 py-2 text-body-md text-on-warning-container">
              No drawer is open at this branch. Recording it without one means the cash is not counted against any
              shift, and a shortage would never show up at close.
            </p>
          )}
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() =>
              run("collect", sessionId ? { registerSessionId: sessionId } : {}, {
                success: "Recorded as collected.",
                confirm: sessions.length ? null : "Record this cash with no drawer open?",
              })
            }
            className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {busy === "collect" ? "Recording…" : "Mark collected"}
          </button>
        </div>
      ) : null}

      {available.some((action) => action.key === "void") ? (
        <div className="flex flex-col gap-3">
          <Field
            id="void-reason"
            label="Reason for voiding"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            autoComplete="off"
          />
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() =>
              run("void", reason.trim() ? { reason: reason.trim() } : {}, {
                success: "Voided.",
                confirm: "Void this payment? No money moves, and it cannot be captured afterwards.",
              })
            }
            className="w-fit rounded-field border border-error px-5 py-2.5 text-label-bold text-error hover:bg-error-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {busy === "void" ? "Voiding…" : "Void"}
          </button>
        </div>
      ) : null}

      {canRefund ? (
        refund.open ? (
          <form onSubmit={requestRefund} className="flex flex-col gap-3 rounded-field bg-surface-container-low p-4">
            <p className="text-label-bold text-on-surface">Request a refund</p>
            <p className="text-body-md text-on-surface-variant">
              {formatMoney(refundable, currency)} of this payment can still go back. Leave the amount empty to refund
              all of it.
            </p>
            <Field
              id="refund-amount"
              label="Amount"
              type="number"
              step="0.01"
              min="0"
              max={String(refundable)}
              value={refund.amount}
              onChange={(event) => setRefund((state) => ({ ...state, amount: event.target.value }))}
              autoComplete="off"
            />
            <Field
              id="refund-reason"
              label="Why"
              value={refund.reason}
              onChange={(event) => setRefund((state) => ({ ...state, reason: event.target.value }))}
              hint="Whoever approves this will read it, and so will anyone asking about it in six months."
              autoComplete="off"
              required
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={Boolean(busy)}
                className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {busy === "refund" ? "Requesting…" : "Request it"}
              </button>
              <button
                type="button"
                onClick={() => setRefund({ open: false, amount: "", reason: "" })}
                className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest"
              >
                Not now
              </button>
            </div>
            <p className="text-body-md text-on-surface-variant">
              This only records the request. Somebody with the refund-approval permission has to agree before any money
              leaves.
            </p>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setRefund({ open: true, amount: "", reason: "" })}
            className="w-fit rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Refund some of this
          </button>
        )
      ) : null}
    </div>
  );
}
