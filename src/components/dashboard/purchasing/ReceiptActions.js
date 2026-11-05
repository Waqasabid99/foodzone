"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { grnPostable } from "@/lib/purchasing";
import FormAlert from "@/components/ui/FormAlert";

/**
 * Posting a delivery, or throwing the draft away.
 *
 * Posting is the irreversible one and the confirmation says so plainly: stock
 * goes in, batches are created, the order is updated and the value lands in
 * "goods received not invoiced" waiting for the supplier's bill. There is no
 * unpost, because unposting would mean deleting stock the kitchen may already
 * have cooked — a mistake is corrected with a return or an adjustment, which
 * both leave a trail.
 */
export default function ReceiptActions({ receipt, currency, canPost, canCancel }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

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
      await api.post(`/admin/goods-receipts/${receipt.id}/${action}`, reason?.trim() ? { reason: reason.trim() } : {});
      toast.success(success);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  const postable = grnPostable(receipt.status);
  if (!postable) {
    return error ? <FormAlert>{error}</FormAlert> : null;
  }

  return (
    <div className="flex flex-col gap-3">
      <FormAlert>{error}</FormAlert>
      <div className="flex flex-wrap gap-2">
        {canPost ? (
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() =>
              run("post", {
                confirm: `Post ${receipt.grnNumber}? ${formatMoney(receipt.grandTotal, currency)} of stock goes in and this cannot be undone.`,
                success: "Posted. The stock is in.",
              })
            }
            className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {busy === "post" ? "Posting…" : "Post to stock"}
          </button>
        ) : null}
        {canCancel ? (
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => run("cancel", { prompt: "Why is this draft being thrown away? (optional)", success: "Draft discarded." })}
            className="w-fit rounded-field border border-error px-5 py-2.5 text-label-bold text-error hover:bg-error-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {busy === "cancel" ? "Discarding…" : "Discard draft"}
          </button>
        ) : null}
      </div>
      {canPost ? (
        <p className="text-body-md text-on-surface-variant">
          Posting puts the accepted quantities into the store room, prices the batches with the freight spread across
          them, and marks the order delivered. There is no undo — a mistake afterwards is a return or an adjustment.
        </p>
      ) : null}
    </div>
  );
}
