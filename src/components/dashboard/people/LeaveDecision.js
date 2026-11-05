"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { employeeName } from "@/lib/hr";

/**
 * Approving, turning down or cancelling one request.
 *
 * **Approval is the commitment**, so it is when the balance is consumed and
 * when the attendance days the leave covers are re-derived — a day already
 * marked absent has to become leave, or the employee is docked for time that
 * was granted.
 *
 * Cancelling approved leave hands the days back. Cancelling a pending request
 * gives nothing back, because nothing was ever taken.
 */
export default function LeaveDecision({ request, canApprove, canReject, canCancel }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const who = employeeName(request.employee);
  const days = Number(request.totalDays);

  async function act(action, confirmText, success) {
    if (busy) return;
    if (confirmText && !window.confirm(confirmText)) return;

    setBusy(action);
    setError(null);
    try {
      await api.post(`/admin/leave-requests/${request.id}/${action}`, { note: note.trim() || null });
      toast.success(success);
      setNote("");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  const pending = request.status === "PENDING";
  const approved = request.status === "APPROVED";
  const offersSomething = (pending && (canApprove || canReject)) || ((pending || approved) && canCancel);
  if (!offersSomething) return null;

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="rounded-field bg-error-container px-3 py-2 text-body-md text-on-error-container">{error}</p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`note-${request.id}`} className="text-label-bold text-on-surface">Note</label>
        <input
          id={`note-${request.id}`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optional — kept with the decision"
          className="w-full rounded-field border border-transparent bg-surface-container-low px-3 py-2.5 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {pending && canApprove ? (
          <button
            type="button"
            onClick={() =>
              act(
                "approve",
                `Approve ${days} ${days === 1 ? "day" : "days"} for ${who}? This takes the days off their balance.`,
                "Leave approved.",
              )
            }
            disabled={Boolean(busy)}
            className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {busy === "approve" ? "Approving…" : "Approve"}
          </button>
        ) : null}

        {pending && canReject ? (
          <button
            type="button"
            onClick={() => act("reject", `Turn down ${who}'s request?`, "Request turned down.")}
            disabled={Boolean(busy)}
            className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {busy === "reject" ? "Turning down…" : "Turn down"}
          </button>
        ) : null}

        {(pending || approved) && canCancel ? (
          <button
            type="button"
            onClick={() =>
              act(
                "cancel",
                approved
                  ? `Cancel ${who}'s approved leave? The ${days} ${days === 1 ? "day goes" : "days go"} back on their balance.`
                  : `Cancel ${who}'s request?`,
                "Cancelled.",
              )
            }
            disabled={Boolean(busy)}
            className="rounded-field border border-error px-5 py-2.5 text-label-bold text-error hover:bg-error-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {busy === "cancel" ? "Cancelling…" : "Cancel"}
          </button>
        ) : null}
      </div>

      {pending && canApprove ? (
        <p className="text-body-md text-on-surface-variant">
          Approving also rewrites the attendance these days cover, so an absence already recorded becomes leave.
        </p>
      ) : null}
    </div>
  );
}
