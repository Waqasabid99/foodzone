"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Check, X } from "lucide-react";
import { api } from "@/lib/api-client";

/**
 * Publish or reject one review.
 *
 * Both directions stay available after a decision, because moderation is
 * reversible and the common correction is "that should not have gone up".
 * A refusal is shown in place — it usually says the review belongs to another
 * branch, which is worth reading rather than guessing at.
 */
export default function ReviewModeration({ review }) {
  const router = useRouter();
  const [pending, setPending] = useState(null);
  const [message, setMessage] = useState(null);

  async function decide(status) {
    setPending(status);
    setMessage(null);
    try {
      await api.put(`/admin/reviews/${review.id}`, { status });
      toast.success(status === "PUBLISHED" ? "Review published." : "Review rejected.");
      router.refresh();
    } catch (failure) {
      setMessage(failure?.message ?? "That could not be saved.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => decide("PUBLISHED")}
          disabled={Boolean(pending) || review.status === "PUBLISHED"}
          className="inline-flex items-center gap-2 rounded-field bg-primary-container px-4 py-2.5 text-label-bold text-on-primary-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Check aria-hidden="true" className="size-4" />
          {pending === "PUBLISHED" ? "Publishing…" : "Publish"}
        </button>
        <button
          type="button"
          onClick={() => decide("REJECTED")}
          disabled={Boolean(pending) || review.status === "REJECTED"}
          className="inline-flex items-center gap-2 rounded-field border border-outline px-4 py-2.5 text-label-bold text-on-surface hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40"
        >
          <X aria-hidden="true" className="size-4" />
          {pending === "REJECTED" ? "Rejecting…" : "Reject"}
        </button>
      </div>
      {message ? (
        <p role="alert" className="rounded-field bg-error-container px-3 py-2 text-label-bold text-on-error-container">
          {message}
        </p>
      ) : null}
    </div>
  );
}
