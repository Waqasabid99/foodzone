"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { dayLabel } from "@/lib/hr";
import FormAlert from "@/components/ui/FormAlert";

/**
 * The two jobs a supervisor does to a range of days.
 *
 * **Rebuild** folds punches into days. It is idempotent — the same punches
 * produce the same day — so it is safe to run again after a terminal catches
 * up. Days somebody has corrected are left alone, because a correction that
 * evaporates on the next run is worse than no correction at all.
 *
 * **Approve** is a signature. Payroll pays what was approved, not what the
 * terminal recorded, which is the point of looking at a missing punch before
 * somebody loses a day's pay to a flat battery.
 */
export default function AttendanceActions({ from, to, branchId = null, employeeId = null, pending = 0, canDerive, canApprove }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const range = { from, to, ...(branchId ? { branchId } : {}), ...(employeeId ? { employeeId } : {}) };
  const rangeLabel = `${dayLabel(from, { weekday: false })} to ${dayLabel(to, { weekday: false })}`;

  async function rebuild(force) {
    if (busy) return;
    if (
      force &&
      !window.confirm(
        `Rebuild ${rangeLabel} and discard the corrections in it? Every manual fix in that range goes back to what the punches say.`,
      )
    ) {
      return;
    }

    setBusy(force ? "force" : "derive");
    setError(null);
    setResult(null);
    try {
      const outcome = await api.post("/admin/attendance/derive", { ...range, force });
      setResult(
        `Rebuilt ${outcome.derived} ${outcome.derived === 1 ? "day" : "days"}` +
          (outcome.skipped ? `, left ${outcome.skipped} alone (corrected or already paid)` : "") +
          (outcome.failed?.length ? `, ${outcome.failed.length} failed` : "") +
          ".",
      );
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "It could not be rebuilt.");
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (busy) return;
    if (!window.confirm(`Approve attendance for ${rangeLabel}? Payroll will pay what you approve.`)) return;

    setBusy("approve");
    setError(null);
    setResult(null);
    try {
      const outcome = await api.post("/admin/attendance/approve", range);
      toast.success(`Approved ${outcome.approved} ${outcome.approved === 1 ? "day" : "days"}.`);
      setResult(
        outcome.missingPunchesApproved
          ? `${outcome.approved} approved — including ${outcome.missingPunchesApproved} with a punch missing. Those are now payable.`
          : `${outcome.approved} approved.`,
      );
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "It could not be approved.");
    } finally {
      setBusy(null);
    }
  }

  if (!canDerive && !canApprove) return null;

  return (
    <div className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
      <div>
        <p className="text-label-bold text-on-surface">{rangeLabel}</p>
        <p className="mt-0.5 text-body-md text-on-surface-variant">
          {pending
            ? `${pending} ${pending === 1 ? "day is" : "days are"} still waiting on a signature.`
            : "Nothing here is waiting on a signature."}
        </p>
      </div>

      <FormAlert>{error}</FormAlert>
      {result ? <FormAlert tone="success">{result}</FormAlert> : null}

      <div className="flex flex-wrap gap-2">
        {canDerive ? (
          <button
            type="button"
            onClick={() => rebuild(false)}
            disabled={Boolean(busy)}
            className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {busy === "derive" ? "Rebuilding…" : "Rebuild from punches"}
          </button>
        ) : null}

        {canApprove ? (
          <button
            type="button"
            onClick={approve}
            disabled={Boolean(busy) || !pending}
            className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {busy === "approve" ? "Approving…" : "Approve this range"}
          </button>
        ) : null}

        {canDerive ? (
          <button
            type="button"
            onClick={() => rebuild(true)}
            disabled={Boolean(busy)}
            className="rounded-field border border-error px-5 py-2.5 text-label-bold text-error hover:bg-error-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {busy === "force" ? "Rebuilding…" : "Rebuild and discard corrections"}
          </button>
        ) : null}
      </div>

      <p className="text-body-md text-on-surface-variant">
        Rebuilding is safe to repeat: the same punches always produce the same day. Days already paid are frozen either
        way.
      </p>
    </div>
  );
}
