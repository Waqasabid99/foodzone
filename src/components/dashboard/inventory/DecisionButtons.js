"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";

/**
 * Approve or reject a document that is waiting.
 *
 * A rejection can carry a reason, kept in the audit log, because "rejected"
 * with no why is the start of an argument. When the approver raised the
 * document themselves, that is said before they press anything.
 */
export default function DecisionButtons({ approveEndpoint, rejectEndpoint, approveLabel = "Approve", rejectLabel = "Reject", approveSuccess, rejectSuccess, confirm = null, selfRaised = false }) {
  const router = useRouter();
  const [pending, setPending] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState(null);

  async function run(kind) {
    if (pending) return;
    if (kind === "approve" && confirm && !window.confirm(confirm)) return;
    setPending(kind);
    setMessage(null);
    try {
      if (kind === "approve") await api.post(approveEndpoint);
      else await api.post(rejectEndpoint, reason.trim() ? { reason: reason.trim() } : {});
      toast.success(kind === "approve" ? approveSuccess : rejectSuccess);
      router.refresh();
    } catch (failure) {
      setMessage(failure?.message ?? "That did not work. Try again.");
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {selfRaised ? (
        <p className="text-body-md text-on-surface-variant">You raised this. You may decide it yourself; it will be recorded as self-approved.</p>
      ) : null}
      {message ? <p role="alert" className="rounded-field bg-error-container px-3 py-2 text-body-md text-on-error-container">{message}</p> : null}
      {rejecting ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="reject-reason" className="text-label-bold text-on-surface">Why is it being rejected?</label>
          <textarea
            id="reject-reason"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Optional, but the person who raised it will want to know"
            className="w-full rounded-field border border-outline bg-surface-container-low px-4 py-3 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={Boolean(pending)} onClick={() => run("reject")} className="rounded-field border border-error px-5 py-2.5 text-label-bold text-error hover:bg-error-container disabled:opacity-60">
              {pending === "reject" ? "Working…" : rejectLabel}
            </button>
            <button type="button" onClick={() => setRejecting(false)} className="rounded-field px-5 py-2.5 text-label-bold text-on-surface-variant hover:text-on-surface">Back</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={Boolean(pending)} onClick={() => run("approve")} className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {pending === "approve" ? "Working…" : approveLabel}
          </button>
          <button type="button" disabled={Boolean(pending)} onClick={() => setRejecting(true)} className="rounded-field border border-outline px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container disabled:opacity-60">
            {rejectLabel}…
          </button>
        </div>
      )}
    </div>
  );
}
