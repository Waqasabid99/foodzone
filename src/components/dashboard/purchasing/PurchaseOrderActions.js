"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { poCancellable, poOpen } from "@/lib/purchasing";
import FormAlert from "@/components/ui/FormAlert";

const PRIMARY =
  "w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const NEUTRAL =
  "w-fit rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const DANGER =
  "w-fit rounded-field border border-error px-5 py-2.5 text-label-bold text-error hover:bg-error-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Moving an order through its stages.
 *
 * Each button says what it commits, because the four are not interchangeable:
 *
 *   * **Send for approval** asks somebody else to agree to the money.
 *   * **Approve** is that agreement, and freezes the document — after it, the
 *     order is what was signed off, so editing stops.
 *   * **Send to supplier** is the order leaving the building.
 *   * **Cancel** is only honest while nothing has arrived. Once any of it has
 *     been delivered the goods exist and are owed for, so the honest ending is
 *     a short close: what came is kept, the rest is no longer expected.
 */
export default function PurchaseOrderActions({ order, currency, can }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const status = order.status;
  const cancellable = poCancellable(order);

  async function run(action, { body, confirm, success, prompt } = {}) {
    if (busy) return;
    let reason;
    if (prompt) {
      reason = window.prompt(prompt);
      if (reason === null) return;
    } else if (confirm && !window.confirm(confirm)) return;

    setBusy(action);
    setError(null);
    try {
      // A blank reason is left out rather than sent as null: the endpoint takes
      // an optional string, and null is not one.
      await api.post(`/admin/purchase-orders/${order.id}/${action}`, {
        ...(body ?? {}),
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      });
      toast.success(success);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  const buttons = [];

  if (can.submit && status === "DRAFT") {
    buttons.push(
      <button key="submit" type="button" disabled={Boolean(busy)} className={PRIMARY} onClick={() => run("submit", { success: "Sent for approval." })}>
        {busy === "submit" ? "Sending…" : "Send for approval"}
      </button>,
    );
  }

  if (can.approve && ["DRAFT", "PENDING_APPROVAL"].includes(status)) {
    buttons.push(
      <button
        key="approve"
        type="button"
        disabled={Boolean(busy)}
        className={PRIMARY}
        onClick={() =>
          run("approve", {
            confirm: `Approve ${order.poNumber}? That commits ${formatMoney(order.grandTotal, currency)} with ${order.supplier.name}, and the order can no longer be edited.`,
            success: "Approved.",
          })
        }
      >
        {busy === "approve" ? "Approving…" : "Approve"}
      </button>,
    );
  }

  if (can.send && status === "APPROVED") {
    buttons.push(
      <button key="send" type="button" disabled={Boolean(busy)} className={PRIMARY} onClick={() => run("send", { success: "Marked as sent." })}>
        {busy === "send" ? "Sending…" : "Mark as sent"}
      </button>,
    );
  }

  if (can.cancel && poOpen(status)) {
    buttons.push(
      cancellable ? (
        <button
          key="cancel"
          type="button"
          disabled={Boolean(busy)}
          className={DANGER}
          onClick={() => run("cancel", { prompt: `Why is ${order.poNumber} being cancelled? (optional)`, success: "Cancelled." })}
        >
          {busy === "cancel" ? "Cancelling…" : "Cancel order"}
        </button>
      ) : (
        <button
          key="close"
          type="button"
          disabled={Boolean(busy)}
          className={NEUTRAL}
          onClick={() => run("close", { prompt: "Why is the rest not coming? (optional)", success: "Closed short." })}
        >
          {busy === "close" ? "Closing…" : "Close short"}
        </button>
      ),
    );
  }

  if (!buttons.length && !error) return null;

  return (
    <div className="flex flex-col gap-3">
      <FormAlert>{error}</FormAlert>
      <div className="flex flex-wrap gap-2">{buttons}</div>
      {can.cancel && poOpen(status) && !cancellable ? (
        <p className="text-body-md text-on-surface-variant">
          Some of this order has already been delivered, so it cannot be cancelled. Closing it short keeps what arrived
          and stops expecting the rest.
        </p>
      ) : null}
    </div>
  );
}
