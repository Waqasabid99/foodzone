"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";

/**
 * Moving a payout through its stages.
 *
 * Three steps, each committing something different, and the wording says so:
 *
 *   * **Approve** agrees the figure. Until then it is arithmetic nobody has
 *     signed off, and the deliveries in it are still free to be recalculated.
 *   * **Mark paid** records that money left. It cannot be unwound here —
 *     a payment is a fact, and reversing one is a separate correction.
 *   * **Cancel** releases the deliveries so a later run can pick them up.
 *
 * A negative payout is possible and is called out rather than hidden: a driver
 * who collected more cash than they earned owes the restaurant, and "pay them
 * −200" is nonsense that somebody has to resolve in person.
 */
export default function PayoutActions({ payout, currency, canApprove, canMarkPaid }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [reference, setReference] = useState("");

  const owed = Number(payout.netAmount);

  async function run(action, { body, confirm, success }) {
    if (busy) return;
    if (confirm && !window.confirm(confirm)) return;

    setBusy(action);
    setError(null);
    try {
      await api.post(`/admin/driver-payouts/${payout.id}/${action}`, body ?? {});
      toast.success(success);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <FormAlert>{error}</FormAlert>

      {owed < 0 ? (
        <p className="rounded-field bg-warning-container px-4 py-3 text-body-md text-on-warning-container">
          This comes out at {formatMoney(owed, currency)} — the driver is holding more of the restaurant&rsquo;s cash
          than they earned this period. Settle the cash with them before approving, or this run pays a negative amount.
        </p>
      ) : null}

      {canApprove && payout.status === "DRAFT" ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() =>
              run("approve", {
                confirm: `Approve ${formatMoney(payout.netAmount, currency)} for this period?`,
                success: "Approved.",
              })
            }
            className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {busy === "approve" ? "Approving…" : "Approve"}
          </button>
          <p className="text-body-md text-on-surface-variant">
            Agreeing the figure. The deliveries in it stop being available to another run.
          </p>
        </div>
      ) : null}

      {canMarkPaid && payout.status === "APPROVED" ? (
        <div className="flex flex-col gap-3 rounded-field bg-surface-container-low p-4">
          <p className="text-label-bold text-on-surface">Record the payment</p>
          <Field
            id="payout-reference"
            label="Reference"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            hint="The transfer or cash-book entry, so this can be found again."
            autoComplete="off"
          />
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() =>
              run("paid", {
                body: reference.trim() ? { paymentReference: reference.trim() } : {},
                confirm: `Record ${formatMoney(payout.netAmount, currency)} as paid? This cannot be undone here.`,
                success: "Recorded as paid.",
              })
            }
            className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {busy === "paid" ? "Recording…" : "Mark as paid"}
          </button>
        </div>
      ) : null}

      {canApprove && ["DRAFT", "APPROVED"].includes(payout.status) ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => run("cancel", { confirm: "Cancel this payout? Its deliveries become available to a later run.", success: "Cancelled." })}
            className="w-fit rounded-field border border-error px-5 py-2.5 text-label-bold text-error hover:bg-error-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {busy === "cancel" ? "Cancelling…" : "Cancel this payout"}
          </button>
          <p className="text-body-md text-on-surface-variant">
            Once the money has gone out a payout cannot be cancelled — the payment is a fact, and unwinding it is a
            separate correction.
          </p>
        </div>
      ) : null}
    </div>
  );
}
