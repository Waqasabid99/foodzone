"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { ATTENDANCE_STATES, correctionPayload, durationLabel } from "@/lib/hr";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import FormAlert from "@/components/ui/FormAlert";

/**
 * A supervisor saying the derivation got it wrong.
 *
 * The reason is required: a correction with no explanation cannot be reviewed
 * by anybody afterwards, and this is the row payroll will pay from.
 *
 * Correcting resets any approval, because the thing that was signed off has
 * changed. It also stops the nightly rebuild touching this day again — a fix
 * that quietly evaporates is worse than none at all.
 */
export default function CorrectionForm({ day }) {
  const router = useRouter();
  const [form, setForm] = useState({
    status: day.status,
    workedMinutes: String(day.workedMinutes ?? 0),
    overtimeMinutes: String(day.overtimeMinutes ?? 0),
    payableFactor: String(day.payableFactor ?? 0),
    reason: "",
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    const { body, errors: local } = correctionPayload(form);
    setErrors(local);
    if (Object.keys(local).length) return setError("Some fields need attention.");

    setPending(true);
    setError(null);
    try {
      await api.patch(`/admin/attendance/${day.id}/correct`, body);
      toast.success("Corrected.");
      setForm({ ...form, reason: "" });
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "It could not be corrected.");
    } finally {
      setPending(false);
    }
  }

  async function revert() {
    if (pending) return;
    if (!window.confirm("Drop the correction and go back to what the punches say?")) return;

    setPending(true);
    setError(null);
    try {
      await api.post(`/admin/attendance/${day.id}/revert`, {});
      toast.success("Back to the derived answer.");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "It could not be reverted.");
    } finally {
      setPending(false);
    }
  }

  if (day.isLocked) {
    return (
      <p className="rounded-field bg-surface-container-high px-4 py-3 text-body-md text-on-surface-variant">
        This day has been paid and is frozen. Its payslip was built from these figures, so changing them now would make
        the two disagree — raise an adjustment in the next payroll period instead.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <FormAlert>{error}</FormAlert>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          id="fix-status"
          label="What actually happened"
          value={form.status}
          onChange={(event) => set({ status: event.target.value })}
          options={Object.entries(ATTENDANCE_STATES).map(([value, state]) => ({ value, label: state.label }))}
          error={errors.status}
        />
        <Field
          id="fix-payable"
          label="Payable factor"
          type="number"
          step="0.5"
          min="0"
          max="2"
          value={form.payableFactor}
          onChange={(event) => set({ payableFactor: event.target.value })}
          error={errors.payableFactor}
          hint="1 is a full day, 0.5 a half day, 0 unpaid."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="fix-worked"
          label="Minutes worked"
          type="number"
          min="0"
          max="1440"
          value={form.workedMinutes}
          onChange={(event) => set({ workedMinutes: event.target.value })}
          error={errors.workedMinutes}
          hint={durationLabel(Number(form.workedMinutes) || 0)}
        />
        <Field
          id="fix-ot"
          label="Overtime minutes"
          type="number"
          min="0"
          max="1440"
          value={form.overtimeMinutes}
          onChange={(event) => set({ overtimeMinutes: event.target.value })}
          error={errors.overtimeMinutes}
          hint={durationLabel(Number(form.overtimeMinutes) || 0)}
        />
      </div>

      <TextAreaField
        id="fix-reason"
        label="Why"
        rows={2}
        value={form.reason}
        onChange={(event) => set({ reason: event.target.value })}
        error={errors.reason}
        hint="Required. This is what a reviewer — or an auditor — reads."
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {pending ? "Saving…" : "Correct this day"}
        </button>

        {day.isManualOverride ? (
          <button
            type="button"
            onClick={revert}
            disabled={pending}
            className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Undo the correction
          </button>
        ) : null}
      </div>

      <p className="text-body-md text-on-surface-variant">
        A correction stands until somebody undoes it — the nightly rebuild leaves it alone. Any approval on this day is
        cleared, because what was signed off has changed.
      </p>
    </form>
  );
}
