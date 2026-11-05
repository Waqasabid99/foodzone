"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import FormAlert from "@/components/ui/FormAlert";

/**
 * Killing a whole print run at once.
 *
 * The thing worth being careful about: revoking is by *campaign tag*, and
 * nothing stops two outlets choosing the same label. The server cuts the
 * operation to the caller's branches so one manager cannot switch off
 * another's codes by collision, and the confirmation says how many it is
 * about to touch rather than asking "are you sure?".
 *
 * Revoked codes are deactivated, never deleted. A customer holding a flyer
 * will try one, and "this code was withdrawn" is answerable where a missing
 * row is not.
 */
export default function RevokeCampaign({ campaign, count }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function revoke() {
    if (pending) return;
    if (
      !window.confirm(
        `Switch off ${count} ${count === 1 ? "code" : "codes"} in "${campaign}"? Anyone holding one will be refused at checkout.`,
      )
    ) {
      return;
    }

    setPending(true);
    setError(null);
    try {
      const result = await api.post("/admin/coupons/revoke", { campaign });
      toast.success(`${result.revoked} revoked.`);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <FormAlert>{error}</FormAlert>
      <button
        type="button"
        onClick={revoke}
        disabled={pending}
        className="w-fit rounded-field border border-error px-5 py-2.5 text-label-bold text-error hover:bg-error-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {pending ? "Revoking…" : `Revoke all ${count} in this batch`}
      </button>
      <p className="text-body-md text-on-surface-variant">
        They stay on the record as revoked rather than disappearing, so a customer who turns up with one can be told
        what happened.
      </p>
    </div>
  );
}
