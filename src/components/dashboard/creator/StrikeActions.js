"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";
import { STRIKE_REASONS } from "@/lib/creator";

/**
 * Issuing a strike, and taking one back.
 *
 * Revoking existed as an endpoint with nothing calling it, which meant the
 * only moderation action in the programme that **undoes** something was the
 * one nobody could reach. A system where mistakes are easy to make and
 * impossible to correct makes moderators cautious in the wrong direction —
 * either nobody gets struck, or nobody who is struck unfairly gets it undone.
 *
 * Both actions ask for a reason. A strike costs a creator their place in the
 * programme at three points, and an audit trail that says only "revoked" tells
 * the next person nothing about whether to trust the one before it.
 */
export default function StrikeActions({ creator, strikes, canAdjust }) {
  const router = useRouter();
  const [mode, setMode] = useState(null);
  const [revoking, setRevoking] = useState(null);
  const [reason, setReason] = useState("MISLEADING_CONTENT");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function run(work, success) {
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      await work();
      toast.success(success);
      // Only on success. A failed revoke has to leave the panel open with the
      // reason still in it, or the moderator retypes it to find out whether
      // the second attempt worked either.
      setMode(null);
      setRevoking(null);
      setNote("");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setPending(false);
    }
  }

  const live = strikes.filter((strike) => !strike.revokedAt);

  return (
    <section className="flex flex-col gap-4">
      <FormAlert>{error}</FormAlert>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-headline-md text-on-surface">Strikes</h2>

        {canAdjust && mode === null ? (
          <button
            type="button"
            onClick={() => setMode("issue")}
            className="rounded-field bg-surface-container-high px-5 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Issue a strike
          </button>
        ) : null}
      </div>

      {mode === "issue" ? (
        <div className="flex flex-col gap-4 rounded-card bg-surface-container-low p-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="strike-reason" className="text-label-bold text-on-surface">
              Why
            </label>
            <select
              id="strike-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="min-h-11 rounded-field bg-surface-container-lowest px-3 text-body-md text-on-surface"
            >
              {Object.entries(STRIKE_REASONS).map(([key, row]) => (
                <option key={key} value={key}>
                  {row.label} ({row.points} {row.points === 1 ? "point" : "points"})
                </option>
              ))}
            </select>
            {/* The consequence, before the button rather than after it. */}
            <p className="text-body-md text-on-surface-variant">
              Adds {STRIKE_REASONS[reason]?.points ?? 1} to their {creator.strikePoints} existing{" "}
              {creator.strikePoints === 1 ? "point" : "points"}.
            </p>
          </div>

          <Field
            id="strike-note"
            label="Note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            hint="What happened. The creator does not see this; the next moderator does."
          />

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    api.post(`/admin/creators/${creator.id}/strikes`, {
                      reason,
                      ...(note.trim() ? { note: note.trim() } : {}),
                    }),
                  "Strike issued.",
                )
              }
              className="rounded-field bg-error px-5 py-2.5 text-label-bold text-on-error disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {pending ? "Working…" : "Issue it"}
            </button>
            <button
              type="button"
              onClick={() => setMode(null)}
              className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {strikes.length ? (
        <ul className="flex flex-col gap-3">
          {strikes.map((strike) => (
            <li key={strike.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
              <div className="min-w-0 flex-1">
                <p className="text-label-bold text-on-surface">
                  {STRIKE_REASONS[strike.reason]?.label ?? strike.reason} · {strike.points}{" "}
                  {strike.points === 1 ? "point" : "points"}
                </p>
                {strike.note ? <p className="mt-1 text-body-md text-on-surface-variant">{strike.note}</p> : null}

                {strike.revokedAt ? (
                  <p className="mt-1 text-body-md text-on-surface-variant">
                    Revoked{strike.revokedReason ? ` — ${strike.revokedReason}` : ""}. It no longer counts.
                  </p>
                ) : null}
              </div>

              {canAdjust && !strike.revokedAt ? (
                revoking === strike.id ? (
                  /* Inline rather than a browser prompt: every other reason
                     field in this dashboard is a real input, and a native
                     dialog cannot be styled, cannot be cancelled with the
                     keyboard predictably, and blocks the page it sits on. */
                  <div className="flex w-full flex-col gap-2 sm:w-80">
                    <Field
                      id={`revoke-${strike.id}`}
                      label="Why take it back?"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          run(
                            () =>
                              api.post(`/admin/creator-strikes/${strike.id}/revoke`, {
                                ...(note.trim() ? { reason: note.trim() } : {}),
                              }),
                            "Strike revoked.",
                          )
                        }
                        className="rounded-field bg-primary-container px-4 py-2 text-label-bold text-on-primary-container disabled:opacity-60 hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        {pending ? "Working…" : "Revoke it"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRevoking(null);
                          setNote("");
                        }}
                        className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setNote("");
                      setRevoking(strike.id);
                    }}
                    className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    Revoke
                  </button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-card bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant">
          No strikes. {live.length === 0 && creator.strikePoints > 0
            ? "Their points come from strikes that have since expired."
            : "Nothing has been held against them."}
        </p>
      )}
    </section>
  );
}
