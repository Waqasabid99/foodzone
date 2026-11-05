"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";
import { REJECTION_REASONS, rejectionCost, videoActions } from "@/lib/creator";

/**
 * Deciding what happens to one video.
 *
 * Three deliberate frictions, all of them about the person on the other end.
 *
 * **The cost of a rejection is on screen before the click.** Every rejection
 * burns one of a small number of attempts and the last one locks that order
 * line for ever — the creator can never film that item again. A moderator
 * working through a queue has no way to know they are on somebody's last
 * chance unless the screen says so.
 *
 * **Approving asks what was actually checked.** The three boxes are written
 * to the immutable review log. An approval with nothing ticked is a decision
 * nobody can review afterwards, which is the point of keeping the log.
 *
 * **A takedown asks separately whether to revoke the sales.** Pulling a video
 * for poor quality should not claw back money from orders that genuinely
 * happened; pulling it for a fake order should. Defaulting either way gets
 * one of those wrong, so it is a question.
 */
export default function VideoModeration({ video, branchName = null, maxUploadAttempts = 5, can = {} }) {
  const router = useRouter();
  const [mode, setMode] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const [checks, setChecks] = useState({ orderVerified: false, productMatched: false, qualityApproved: false });
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [takedownReason, setTakedownReason] = useState("");
  const [revokeAttributions, setRevokeAttributions] = useState(false);

  const allowed = videoActions(video);
  const cost = rejectionCost(video, { maxUploadAttempts });

  async function send(label, call) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await call();
      toast.success(label);
      setMode(null);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setPending(false);
    }
  }

  const approve = () =>
    send("Published.", () =>
      api.post(`/admin/creator-videos/${video.id}/review`, { decision: "APPROVED", checks, note: note.trim() || undefined }),
    );

  const reject = () =>
    send("Sent back.", () =>
      api.post(`/admin/creator-videos/${video.id}/review`, {
        decision: "REJECTED",
        reason,
        note: note.trim() || undefined,
        checks,
      }),
    );

  const takeDown = () =>
    send("Taken down.", () =>
      api.post(`/admin/creator-videos/${video.id}/takedown`, { reason: takedownReason.trim(), revokeAttributions }),
    );

  const reinstate = () =>
    send("Back up.", () => api.post(`/admin/creator-videos/${video.id}/reinstate`, { note: note.trim() || undefined }));

  const buttons = [
    allowed.canApprove && can.publish ? { key: "approve", label: "Approve" } : null,
    allowed.canReject && can.reject ? { key: "reject", label: "Send back" } : null,
    allowed.canTakeDown && can.takedown ? { key: "takedown", label: "Take down" } : null,
    allowed.canReinstate && can.publish ? { key: "reinstate", label: "Put back up" } : null,
  ].filter(Boolean);

  if (!buttons.length) return null;

  return (
    <div className="flex flex-col gap-3">
      <FormAlert>{error}</FormAlert>

      {mode === null ? (
        <div className="flex flex-wrap gap-2">
          {buttons.map((button) => (
            <button
              key={button.key}
              type="button"
              onClick={() => setMode(button.key)}
              className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {button.label}
            </button>
          ))}
        </div>
      ) : null}

      {mode === "approve" ? (
        <div className="flex flex-col gap-3 rounded-card bg-surface-container-low p-4">
          <p className="text-body-md text-on-surface">
            Approving puts this on the product page at{" "}
            <strong>{branchName || "the branch it was filmed at"}</strong>, and nowhere else.
          </p>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-label-bold text-on-surface">What did you check?</legend>
            {[
              ["orderVerified", "The order really contains this item"],
              ["productMatched", "The video shows that item"],
              ["qualityApproved", "Good enough to sit on a product page"],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-body-md text-on-surface">
                <input
                  type="checkbox"
                  checked={checks[key]}
                  onChange={(event) => setChecks((state) => ({ ...state, [key]: event.target.checked }))}
                  className="size-4 accent-primary"
                />
                {label}
              </label>
            ))}
          </fieldset>
          <Actions pending={pending} confirm="Approve and publish" onConfirm={approve} onCancel={() => setMode(null)} />
        </div>
      ) : null}

      {mode === "reject" ? (
        <div className="flex flex-col gap-3 rounded-card bg-surface-container-low p-4">
          <p className={`text-body-md ${cost.tone === "bad" ? "font-semibold text-error" : "text-on-surface-variant"}`}>
            {cost.sentence}
          </p>
          <SelectField
            id={`reject-reason-${video.id}`}
            label="Why"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            options={[
              { value: "", label: "Choose a reason" },
              ...Object.entries(REJECTION_REASONS).map(([value, row]) => ({ value, label: row.label })),
            ]}
            hint="The creator sees this."
            required
          />
          {REJECTION_REASONS[reason]?.costly ? (
            <p className="rounded-field bg-warning-container px-4 py-3 text-body-md text-on-warning-container">
              That reason says they did something wrong rather than that the file was unusable. Consider a strike as
              well — a rejection on its own does not count towards one.
            </p>
          ) : null}
          <Field
            id={`reject-note-${video.id}`}
            label="Note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            hint="Optional. Tell them what would fix it."
            autoComplete="off"
          />
          <Actions
            pending={pending}
            disabled={!reason}
            confirm="Send it back"
            onConfirm={reject}
            onCancel={() => setMode(null)}
          />
        </div>
      ) : null}

      {mode === "takedown" ? (
        <div className="flex flex-col gap-3 rounded-card bg-surface-container-low p-4">
          <Field
            id={`takedown-${video.id}`}
            label="Why it is coming down"
            value={takedownReason}
            onChange={(event) => setTakedownReason(event.target.value)}
            autoComplete="off"
            required
          />
          <label className="flex items-start gap-2 text-body-md text-on-surface">
            <input
              type="checkbox"
              checked={revokeAttributions}
              onChange={(event) => setRevokeAttributions(event.target.checked)}
              className="mt-1 size-4 accent-primary"
            />
            <span>
              Also cancel the sales it is credited with.
              <span className="block text-on-surface-variant">
                Only for fraud. Those orders were real otherwise, and the creator keeps what they earned.
              </span>
            </span>
          </label>
          <Actions
            pending={pending}
            disabled={!takedownReason.trim()}
            confirm="Take it down"
            onConfirm={takeDown}
            onCancel={() => setMode(null)}
          />
        </div>
      ) : null}

      {mode === "reinstate" ? (
        <div className="flex flex-col gap-3 rounded-card bg-surface-container-low p-4">
          <p className="text-body-md text-on-surface">This puts it back on the product page everywhere.</p>
          <Field
            id={`reinstate-${video.id}`}
            label="Note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            hint="Optional, for the moderation log."
            autoComplete="off"
          />
          <Actions pending={pending} confirm="Put it back" onConfirm={reinstate} onCancel={() => setMode(null)} />
        </div>
      ) : null}
    </div>
  );
}

function Actions({ pending, disabled = false, confirm, onConfirm, onCancel }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={onConfirm}
        disabled={pending || disabled}
        className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {pending ? "Working…" : confirm}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest"
      >
        Not now
      </button>
    </div>
  );
}
