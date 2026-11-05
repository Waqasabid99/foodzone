"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import FormAlert from "@/components/ui/FormAlert";

const PRIMARY =
  "w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const DANGER =
  "w-fit rounded-field border border-error px-5 py-2.5 text-label-bold text-error hover:bg-error-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Moving a bill through its stages.
 *
 * **Approving is the commitment**, not recording. Until it is approved the
 * invoice is a piece of paper somebody transcribed; approving it says the
 * restaurant agrees it owes the money, which is why it posts to payables and
 * why it has a permission of its own.
 *
 * Cancelling an approved bill reverses that entry rather than quietly leaving
 * a payable behind — and it is refused outright once anything has been paid,
 * because money leaving is a fact and unwinding it is a separate correction.
 */
export default function BillActions({ bill, currency, canSubmit, canApprove }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const paid = Number(bill.paidAmount) > 0;

  async function run(action, { confirm, prompt, success }) {
    if (busy) return;
    let reason;
    if (prompt) {
      reason = window.prompt(prompt);
      if (reason === null) return;
    } else if (confirm && !window.confirm(confirm)) return;

    setBusy(action);
    setError(null);
    try {
      await api.post(`/admin/supplier-bills/${bill.id}/${action}`, action === "cancel" ? { reason: reason?.trim() || null } : {});
      toast.success(success);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  const buttons = [];

  if (canSubmit && bill.status === "DRAFT") {
    buttons.push(
      <button key="submit" type="button" disabled={Boolean(busy)} className={PRIMARY} onClick={() => run("submit", { success: "Sent for approval." })}>
        {busy === "submit" ? "Sending…" : "Send for approval"}
      </button>,
    );
  }

  if (canApprove && ["DRAFT", "AWAITING_APPROVAL"].includes(bill.status)) {
    buttons.push(
      <button
        key="approve"
        type="button"
        disabled={Boolean(busy)}
        className={PRIMARY}
        onClick={() =>
          run("approve", {
            confirm: `Approve ${bill.billNumber}? ${formatMoney(bill.grandTotal, currency)} becomes a payable owed to ${bill.supplier.name}.`,
            success: "Approved and posted to payables.",
          })
        }
      >
        {busy === "approve" ? "Approving…" : "Approve"}
      </button>,
    );
  }

  if (canApprove && bill.status !== "CANCELLED" && bill.status !== "PAID" && !paid) {
    buttons.push(
      <button
        key="cancel"
        type="button"
        disabled={Boolean(busy)}
        className={DANGER}
        onClick={() =>
          run("cancel", {
            prompt: `Why is ${bill.billNumber} being cancelled? (optional)`,
            success: "Cancelled.",
          })
        }
      >
        {busy === "cancel" ? "Cancelling…" : "Cancel bill"}
      </button>,
    );
  }

  if (!buttons.length && !error) return null;

  return (
    <div className="flex flex-col gap-3">
      <FormAlert>{error}</FormAlert>
      <div className="flex flex-wrap gap-2">{buttons}</div>
      {paid && bill.status !== "PAID" ? (
        <p className="text-body-md text-on-surface-variant">
          Something has already been paid against this bill, so it cannot be cancelled. Reverse the payments first.
        </p>
      ) : null}
    </div>
  );
}
