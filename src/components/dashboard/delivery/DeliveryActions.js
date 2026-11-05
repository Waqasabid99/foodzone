"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { canReassign, deliveryAction } from "@/lib/delivery";
import FormAlert from "@/components/ui/FormAlert";

const FORWARD =
  "rounded-field bg-primary-container px-5 py-3 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const NEUTRAL =
  "rounded-field bg-surface-container-high px-5 py-3 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const DANGER =
  "rounded-field border border-error px-5 py-3 text-label-bold text-error hover:bg-error-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Moving a delivery along from the dispatch desk.
 *
 * The buttons come from `nextStatuses`, which the **server** derives from the
 * same graph it enforces — a client keeping its own copy drifts and then
 * offers a button that 409s.
 *
 * Failing a delivery asks for a reason and the server insists on one. That is
 * not bureaucracy: "failed" with no reason is the row nobody can explain when
 * the customer rings, and somebody has to decide whether to refund.
 *
 * Sending a job back to the pool is offered only while the food is still in
 * the shop. After pickup it is in somebody's bag, and unassigning then makes
 * the system disagree with the street about who has the customer's dinner.
 */
export default function DeliveryActions({ delivery, canUpdate, canFail, canReassignJob }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const next = (delivery.nextStatuses ?? []).filter((status) => !["FAILED", "CANCELLED", "PENDING"].includes(status));
  const canFailNow = canFail && (delivery.nextStatuses ?? []).includes("FAILED");
  const canPool = canReassignJob && canReassign(delivery);

  async function move(status) {
    if (busy) return;
    const action = deliveryAction(status);

    let reason;
    if (status === "FAILED") {
      reason = window.prompt("Why did it fail? Nobody in, wrong address, refused — the refund desk will read this.");
      if (reason === null) return;
      if (reason.trim().length < 3) {
        setError("Give a reason. Without one nobody can explain this delivery later.");
        return;
      }
    } else if (status === "DELIVERED" && !window.confirm("Mark as delivered? This closes the job.")) {
      return;
    }

    setBusy(status);
    setError(null);
    try {
      await api.put(`/admin/deliveries/${delivery.id}/status`, {
        status,
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      });
      toast.success(`${action.verb}.`);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  async function backToPool() {
    if (busy) return;
    const reason = window.prompt("Why is it going back to the pool? (optional)");
    if (reason === null) return;

    setBusy("pool");
    setError(null);
    try {
      await api.post(`/admin/deliveries/${delivery.id}/unassign`, reason.trim() ? { reason: reason.trim() } : {});
      toast.success("Back in the pool for another driver.");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  if (!next.length && !canFailNow && !canPool) {
    return error ? <FormAlert>{error}</FormAlert> : null;
  }

  return (
    <div className="flex flex-col gap-3">
      <FormAlert>{error}</FormAlert>

      {canUpdate && next.length ? (
        <>
          <div className="flex flex-wrap gap-2">
            {next.map((status) => (
              <button key={status} type="button" disabled={Boolean(busy)} className={FORWARD} onClick={() => move(status)}>
                {busy === status ? "Working…" : deliveryAction(status).verb}
              </button>
            ))}
          </div>
          <p className="text-body-md text-on-surface-variant">{deliveryAction(next[0]).hint}</p>
        </>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canPool ? (
          <button type="button" disabled={Boolean(busy)} className={NEUTRAL} onClick={backToPool}>
            {busy === "pool" ? "Returning…" : "Back to the pool"}
          </button>
        ) : null}
        {canFailNow ? (
          <button type="button" disabled={Boolean(busy)} className={DANGER} onClick={() => move("FAILED")}>
            {busy === "FAILED" ? "Working…" : "Mark failed"}
          </button>
        ) : null}
      </div>

      {canReassignJob && delivery.driverId && !canPool && !["DELIVERED", "CANCELLED", "FAILED"].includes(delivery.status) ? (
        <p className="text-body-md text-on-surface-variant">
          The food is already in the driver&rsquo;s bag, so this job cannot be moved to somebody else. If it cannot be
          completed, mark it failed — that keeps the record straight about where the food went.
        </p>
      ) : null}
    </div>
  );
}
