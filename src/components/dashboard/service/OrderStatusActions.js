"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { REFUSALS, statusAction } from "@/lib/service";
import FormAlert from "@/components/ui/FormAlert";

const FORWARD =
  "rounded-field bg-primary-container px-5 py-3 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const REFUSE =
  "rounded-field border border-error px-5 py-3 text-label-bold text-error hover:bg-error-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Moving an order along.
 *
 * The buttons come from `nextStatuses`, which the **server** computes from the
 * same transition table it enforces. Nothing here second-guesses it: a client
 * that keeps its own copy of the rules drifts, and then offers a button that
 * 409s — which teaches staff that the screen lies.
 *
 * Each button is the verb for what it does rather than a generic "next",
 * because "Accept" and "Start cooking" are two different promises to a
 * customer and the difference matters when one of them is a waste of food.
 *
 * A cancellation asks for a reason and the server insists on one. That is not
 * bureaucracy: "cancelled" with no reason is the row nobody can explain when
 * the customer rings back, and the refund desk has to guess.
 */
export default function OrderStatusActions({ order, canAdvance, canCancel }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const next = (order.nextStatuses ?? []).filter((status) => !REFUSALS.includes(status));
  const refusals = (order.nextStatuses ?? []).filter((status) => REFUSALS.includes(status));

  async function advance(status) {
    if (busy) return;
    const action = statusAction(status);
    if (status === "COMPLETED" && !window.confirm(`Close ${order.orderNumber}? ${action.hint}`)) return;

    setBusy(status);
    setError(null);
    try {
      await api.put(`/admin/orders/${order.id}/status`, { status });
      toast.success(`${order.orderNumber} ${action.done}.`);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  async function refuse(status) {
    if (busy) return;
    const word = status === "REJECTED" ? "rejected" : "cancelled";
    const reason = window.prompt(`Why is ${order.orderNumber} being ${word}? The customer may be told.`);
    if (reason === null) return;
    if (reason.trim().length < 3) {
      setError("Give a reason — even three words. Without one nobody can explain this order later.");
      return;
    }

    setBusy(status);
    setError(null);
    try {
      // Cancelling has its own endpoint: it releases stock and records who
      // called it off, which a plain status change does not.
      await api.post(`/admin/orders/${order.id}/cancel`, { reason: reason.trim() });
      toast.success(`${order.orderNumber} ${word}.`);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  if (!next.length && !refusals.length) {
    return error ? <FormAlert>{error}</FormAlert> : null;
  }

  return (
    <div className="flex flex-col gap-3">
      <FormAlert>{error}</FormAlert>

      {canAdvance && next.length ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {next.map((status) => (
              <button key={status} type="button" disabled={Boolean(busy)} onClick={() => advance(status)} className={FORWARD}>
                {busy === status ? "Working…" : statusAction(status).verb}
              </button>
            ))}
          </div>
          <p className="text-body-md text-on-surface-variant">{statusAction(next[0]).hint}</p>
        </div>
      ) : null}

      {canCancel && refusals.length ? (
        <div className="flex flex-wrap gap-2">
          {refusals.map((status) => (
            <button key={status} type="button" disabled={Boolean(busy)} onClick={() => refuse(status)} className={REFUSE}>
              {busy === status ? "Working…" : statusAction(status).verb}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
