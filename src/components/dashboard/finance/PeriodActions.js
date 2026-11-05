"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";
import { periodAction } from "@/lib/finance";

/**
 * Closing, locking and reopening an accounting period.
 *
 * Three actions with very different weights, and the screen refuses to let
 * them look alike:
 *
 *   * **Close** stops anything posting into the month. Reversible.
 *   * **Reopen** lets the figures move again in a month that may already have
 *     been reported, so it takes a written reason.
 *   * **Lock** is final. There is no undo anywhere in the system, and the
 *     confirmation says exactly that rather than asking "are you sure?".
 *
 * Why a period cannot be closed is shown on the row instead of being
 * discovered by clicking: a draft entry still sitting in it, or an earlier
 * month still open. The second is the one people get wrong — closing out of
 * order leaves a closed month whose figures can still change underneath a
 * report that has already gone out.
 */
export default function PeriodActions({ period, canClose, canReopen }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [reason, setReason] = useState("");
  const [reopening, setReopening] = useState(false);

  const verdict = periodAction(period, { drafts: period.drafts, earlierOpen: period.earlierOpen });

  async function run(action, body, { success, confirm }) {
    if (busy) return;
    if (confirm && !window.confirm(confirm)) return;

    setBusy(action);
    setError(null);
    try {
      await api.post(`/admin/accounting-periods/${period.id}/${action}`, body ?? {});
      toast.success(success);
      setReopening(false);
      setReason("");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  if (period.status === "LOCKED") {
    return <p className="text-body-md text-on-surface-variant">Locked. Nothing can change this month again.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <FormAlert>{error}</FormAlert>

      {period.status === "OPEN" ? (
        canClose ? (
          verdict?.can ? (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() =>
                  run("close", {}, {
                    success: "Closed.",
                    confirm: `Close ${period.name}? Nothing will post into it afterwards. It can be reopened.`,
                  })
                }
                className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {busy === "close" ? "Closing…" : "Close this month"}
              </button>
              <p className="text-body-md text-on-surface-variant">{verdict.warning}</p>
            </div>
          ) : (
            <p className="rounded-field bg-surface-container-low px-4 py-3 text-body-md text-on-surface-variant">
              {verdict?.reason}
            </p>
          )
        ) : null
      ) : null}

      {period.status === "CLOSED" ? (
        <div className="flex flex-col gap-3">
          {canReopen ? (
            reopening ? (
              <form
                className="flex flex-col gap-3 rounded-field bg-surface-container-low p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!reason.trim()) return;
                  run("reopen", { reason: reason.trim() }, { success: "Reopened." });
                }}
              >
                <Field
                  id={`reopen-${period.id}`}
                  label="Why is this being reopened"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  hint="Recorded against the period. Anyone comparing two versions of this month's figures will want it."
                  autoComplete="off"
                  required
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={Boolean(busy) || !reason.trim()}
                    className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {busy === "reopen" ? "Reopening…" : "Reopen it"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReopening(false)}
                    className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest"
                  >
                    Not now
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setReopening(true)}
                className="w-fit rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Reopen
              </button>
            )
          ) : null}

          {canClose ? (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() =>
                  run("lock", {}, {
                    success: "Locked.",
                    confirm: `Lock ${period.name} for good? There is no way to undo this, here or anywhere else.`,
                  })
                }
                className="w-fit rounded-field border border-error px-5 py-2.5 text-label-bold text-error hover:bg-error-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {busy === "lock" ? "Locking…" : "Lock it for good"}
              </button>
              <p className="text-body-md text-on-surface-variant">
                For a month whose figures have been filed and have left the building. It cannot be reopened afterwards.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
