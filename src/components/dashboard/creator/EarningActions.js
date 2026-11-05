"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";
import { earningActions } from "@/lib/creator";

/**
 * Taking an earning back.
 *
 * Two different acts, kept apart because they are not reversible in the same
 * way. **Voiding** cancels money that has not been paid yet — the earning is
 * still inside its refund hold, nothing has reached the wallet, and the
 * creator simply never receives it. **Clawing back** takes credit out of a
 * wallet the creator may already have spent from, which can leave the balance
 * at zero and a purchase already made.
 *
 * **Unlinking** is a third thing again, and the only one that touches the
 * creator's record rather than their money. Voiding says "this sale earns
 * nothing"; unlinking says "this video did not cause this sale at all", and so
 * removes it from their attributed-sales count as well. That is the one to
 * reach for when somebody has been gaming attribution, because leaving the
 * sale on their record while zeroing the money flatters a number the next
 * commission rule may well pay against.
 *
 * All three require a reason, because all three appear in the creator's own
 * ledger and "an admin removed this" with no explanation is the kind of thing
 * that ends a creator programme.
 */
export default function EarningActions({ earning, can = false }) {
  const router = useRouter();
  const [mode, setMode] = useState(null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const allowed = earningActions(earning);
  // Unlinking is refused once the credit has gone out — the service says to
  // claw the earning back instead — so it is offered on exactly the same
  // states voiding is.
  const canUnlink = allowed.canReject && Boolean(earning.attributionId);
  if (!can || (!allowed.canReverse && !allowed.canReject)) return null;

  async function send(path, label) {
    if (pending || !reason.trim()) return;
    setPending(true);
    setError(null);
    try {
      if (path === "unlink") {
        await api.delete(`/admin/creator-attributions/${earning.attributionId}`, {
          body: { reason: reason.trim() },
        });
      } else {
        await api.post(`/admin/creator-earnings/${earning.id}/${path}`, { reason: reason.trim() });
      }
      toast.success(label);
      setMode(null);
      setReason("");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <FormAlert>{error}</FormAlert>

      {mode === null ? (
        <div className="flex flex-wrap gap-2">
          {allowed.canReject ? (
            <button
              type="button"
              onClick={() => setMode("reject")}
              className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Void it
            </button>
          ) : null}
          {allowed.canReverse ? (
            <button
              type="button"
              onClick={() => setMode("reverse")}
              className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Claw it back
            </button>
          ) : null}
          {canUnlink ? (
            <button
              type="button"
              onClick={() => setMode("unlink")}
              className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Not from this video
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-card bg-surface-container-low p-4">
          <p className="text-body-md text-on-surface">
            {mode === "reverse"
              ? "This takes credit out of the creator's wallet. If they have already spent it the balance can go to zero, and the purchase they made with it still stands."
              : mode === "unlink"
                ? "This says the video did not cause this sale. The earning is cancelled and the order stops counting towards the creator's attributed sales, so a commission rule cannot pay against it later."
                : "This cancels an earning that has not been paid out. Nothing leaves the wallet, because nothing reached it."}
          </p>
          <Field
            id={`earning-reason-${earning.id}`}
            label="Reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            hint="The creator sees this on their ledger."
            autoComplete="off"
            required
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || !reason.trim()}
              onClick={() =>
                send(mode, mode === "reverse" ? "Clawed back." : mode === "unlink" ? "Unlinked." : "Voided.")
              }
              className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {pending ? "Working…" : mode === "reverse" ? "Claw it back" : mode === "unlink" ? "Unlink it" : "Void it"}
            </button>
            <button
              type="button"
              onClick={() => setMode(null)}
              className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest"
            >
              Not now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
