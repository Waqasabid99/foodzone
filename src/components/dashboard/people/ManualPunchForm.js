"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { PUNCH_DIRECTIONS, employeeName, manualPunchPayload } from "@/lib/hr";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import FormAlert from "@/components/ui/FormAlert";

/**
 * Adding a punch by hand.
 *
 * Punches are raw and never edited — the terminal's record of when somebody
 * arrived is evidence, and a system that lets it be rewritten is a spreadsheet
 * with extra steps. So a correction is a *new* punch alongside the others,
 * marked as typed by a person and carrying their name: vouching for somebody's
 * hours should have a name against it.
 *
 * Adding one does not change the day by itself. Rebuild it afterwards.
 */
export default function ManualPunchForm({ employees, employeeId = null, date = null, onAdded = null }) {
  const router = useRouter();
  const [form, setForm] = useState({
    employeeId: employeeId ?? "",
    date: date ?? new Date().toISOString().slice(0, 10),
    time: "",
    direction: "IN",
    note: "",
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    const { body, errors: local } = manualPunchPayload(form);
    setErrors(local);
    if (Object.keys(local).length) return setError("Some fields need attention.");

    setPending(true);
    setError(null);
    try {
      await api.post("/admin/attendance-punches/manual", body);
      toast.success("Punch added. Rebuild the day to fold it in.");
      set({ time: "", note: "" });
      router.refresh();
      onAdded?.();
    } catch (failure) {
      setError(failure?.message ?? "It could not be added.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <FormAlert>{error}</FormAlert>

      {employeeId ? null : (
        <SelectField
          id="punch-employee"
          label="Who"
          value={form.employeeId}
          onChange={(event) => set({ employeeId: event.target.value })}
          options={[
            { value: "", label: "Choose someone" },
            ...employees.map((employee) => ({ value: employee.id, label: `${employeeName(employee)} — ${employee.employeeCode}` })),
          ]}
          error={errors.employeeId}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="punch-date" label="Day" type="date" value={form.date} onChange={(event) => set({ date: event.target.value })} error={errors.date} />
        <Field id="punch-time" label="Time" type="time" value={form.time} onChange={(event) => set({ time: event.target.value })} error={errors.time} />
        <SelectField
          id="punch-direction"
          label="Direction"
          value={form.direction}
          onChange={(event) => set({ direction: event.target.value })}
          options={Object.entries(PUNCH_DIRECTIONS).map(([value, label]) => ({ value, label }))}
        />
      </div>

      <TextAreaField
        id="punch-note"
        label="Note"
        rows={2}
        value={form.note}
        onChange={(event) => set({ note: event.target.value })}
        error={errors.note}
        hint="Why you are vouching for this. Kept with the punch."
      />

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {pending ? "Adding…" : "Add the punch"}
      </button>

      <p className="text-body-md text-on-surface-variant">
        Nothing on the terminal is changed. The punch sits alongside the real ones and counts the moment the day is
        rebuilt.
      </p>
    </form>
  );
}
