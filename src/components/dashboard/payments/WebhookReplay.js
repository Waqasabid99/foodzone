"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";

/**
 * Replaying a payment callback the provider already sent.
 *
 * This is the recovery for the worst five minutes in the system: a customer
 * paid, the provider told us, and the callback died on the way in — so the
 * money is taken and the order is still sitting there unpaid. The event was
 * stored on arrival with its signature already verified, so replaying it runs
 * the same handler against the same bytes.
 *
 * Idempotent by construction: the handler keys on `(provider, eventId)`, which
 * is a unique index, so replaying something that did go through a second time
 * is a no-op rather than a double credit. That is what makes it safe to offer
 * as a button rather than hedge behind a confirmation.
 */
export default function WebhookReplay({ event }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function replay() {
    if (pending) return;
    setPending(true);

    try {
      const result = await api.post(`/admin/payment-webhooks/${event.id}/replay`, {});
      toast.success(result?.status === "PROCESSED" ? "Replayed, and it went through." : "Replayed.");
      router.refresh();
    } catch (error) {
      toast.error(error?.message ?? "The replay failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={replay}
      disabled={pending}
      className="rounded-field bg-primary-container px-5 py-2 text-label-bold text-on-primary-container disabled:opacity-60 hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {pending ? "Replaying…" : "Replay"}
    </button>
  );
}
