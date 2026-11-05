"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { MINUTES_PER_DAY, clockValue, durationLabel, minutesFromClock, shiftPayload, suggestThresholds } from "@/lib/hr";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";

/**
 * A shift is a template: "evening, 18:00 to 02:00, half an hour off".
 *
 * Two things the form has to get right:
 *
 *   * **A night shift is expressible.** An end at or before the start is rolled
 *     forward a day, so 22:00–06:00 is stored as 1320–1800. Stored as 1320–360
 *     every duration goes negative and every night worker appears to owe the
 *     company sixteen hours.
 *   * **Retiming a shift that has been worked is refused**, and the form says
 *     so before you try rather than after the save fails. Somebody who was on
 *     time would become late, and a day that paid in full would become half.
 */
export default function ShiftForm({ shift = null, branches }) {
  const router = useRouter();
  const editing = Boolean(shift);
  const frozen = editing && shift.workedDays > 0;

  const [form, setForm] = useState({
    name: shift?.name ?? "",
    branchId: shift?.branchId ?? (branches.length === 1 ? branches[0].id : ""),
    startTime: shift ? clockValue(shift.startMinute) : "09:00",
    endTime: shift ? clockValue(shift.endMinute) : "17:00",
    breakMinutes: String(shift?.breakMinutes ?? 30),
    graceMinutes: String(shift?.graceMinutes ?? 10),
    halfDayThresholdMinutes: String(shift?.halfDayThresholdMinutes ?? 225),
    fullDayThresholdMinutes: String(shift?.fullDayThresholdMinutes ?? 450),
    isActive: shift?.isActive ?? true,
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  /** Retimes the thresholds with the hours, so they never silently disagree. */
  function retime(patch) {
    const next = { ...form, ...patch };
    const suggested = suggestThresholds(next);
    set(
      suggested
        ? {
            ...patch,
            fullDayThresholdMinutes: String(suggested.fullDayThresholdMinutes),
            halfDayThresholdMinutes: String(suggested.halfDayThresholdMinutes),
          }
        : patch,
    );
  }

  const preview = (() => {
    const start = minutesFromClock(form.startTime);
    const rawEnd = minutesFromClock(form.endTime);
    if (start == null || rawEnd == null) return null;
    const end = rawEnd <= start ? rawEnd + MINUTES_PER_DAY : rawEnd;
    const breaks = Number(form.breakMinutes) || 0;
    return { overnight: end > MINUTES_PER_DAY, paid: Math.max(0, end - start - breaks) };
  })();

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    const { body, errors: local } = shiftPayload(form, { mode: editing ? "edit" : "create" });
    setErrors(local);
    if (Object.keys(local).length) return setFormError("Some fields need attention.");

    // A shift that has been worked keeps its times: the server refuses them,
    // and sending them unchanged would still trip that refusal.
    const payload = frozen
      ? { name: body.name, graceMinutes: body.graceMinutes, halfDayThresholdMinutes: body.halfDayThresholdMinutes, fullDayThresholdMinutes: body.fullDayThresholdMinutes, isActive: body.isActive }
      : body;

    setPending(true);
    setFormError(null);
    try {
      if (editing) {
        await api.patch(`/admin/shifts/${shift.id}`, payload);
        toast.success("Saved.");
      } else {
        const created = await api.post("/admin/shifts", body);
        toast.success(`${created.name} added.`);
        router.push(`/dashboard/shifts/${created.id}`);
      }
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <FormAlert>{formError}</FormAlert>

      {frozen ? (
        <p role="status" className="rounded-card bg-warning-container px-5 py-3 text-body-md text-on-warning-container">
          {shift.workedDays} attendance {shift.workedDays === 1 ? "day has" : "days have"} been worked against these
          hours, so the times are fixed. Changing them would make somebody who was on time late, and a full day a half
          one. Create a new shift and roster onto it instead.
        </p>
      ) : null}

      <Section title="When it runs">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="shift-name" label="Name" value={form.name} onChange={(event) => set({ name: event.target.value })} error={errors.name} placeholder="Evening" autoComplete="off" />
          {editing ? null : (
            <SelectField
              id="shift-branch"
              label="Branch"
              value={form.branchId}
              onChange={(event) => set({ branchId: event.target.value })}
              options={[{ value: "", label: "Choose a branch" }, ...branches.map((branch) => ({ value: branch.id, label: branch.name }))]}
              error={errors.branchId}
              hint="A shift belongs to one outlet; you can only roster its own staff onto it."
            />
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="shift-start" label="Starts" type="time" value={form.startTime} onChange={(event) => retime({ startTime: event.target.value })} error={errors.startTime} disabled={frozen} />
          <Field id="shift-end" label="Ends" type="time" value={form.endTime} onChange={(event) => retime({ endTime: event.target.value })} error={errors.endTime} disabled={frozen} hint="Earlier than the start means the next morning." />
          <Field id="shift-break" label="Unpaid break" type="number" min="0" max="480" value={form.breakMinutes} onChange={(event) => retime({ breakMinutes: event.target.value })} error={errors.breakMinutes} disabled={frozen} hint="Minutes." />
        </div>

        {preview ? (
          <p className="text-body-md text-on-surface-variant">
            {preview.overnight ? "Runs past midnight — the shift belongs to the day it started. " : ""}
            Paid time: <span className="text-on-surface">{durationLabel(preview.paid)}</span>.
          </p>
        ) : null}
      </Section>

      <Section
        title="What counts"
        description="How derivation reads a day worked on this shift. Grace forgives lateness; the thresholds decide whether a short day pays in full, half, or not at all."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="shift-grace" label="Grace" type="number" min="0" max="120" value={form.graceMinutes} onChange={(event) => set({ graceMinutes: event.target.value })} error={errors.graceMinutes} hint="Minutes late that are forgiven." />
          <Field id="shift-full" label="A full day needs" type="number" min="0" max="1440" value={form.fullDayThresholdMinutes} onChange={(event) => set({ fullDayThresholdMinutes: event.target.value })} error={errors.fullDayThresholdMinutes} hint="Minutes worked." />
          <Field id="shift-half" label="A half day needs" type="number" min="0" max="1440" value={form.halfDayThresholdMinutes} onChange={(event) => set({ halfDayThresholdMinutes: event.target.value })} error={errors.halfDayThresholdMinutes} hint="Minutes worked." />
        </div>

        <label className="flex w-fit items-center gap-2 text-body-md text-on-surface">
          <input type="checkbox" checked={form.isActive} onChange={(event) => set({ isActive: event.target.checked })} className="size-4 accent-primary" />
          Available to roster
        </label>
      </Section>

      <div className="min-w-48 max-w-xs">
        <SubmitButton pending={pending} pendingLabel="Saving…">{editing ? "Save changes" : "Create shift"}</SubmitButton>
      </div>
    </form>
  );
}
