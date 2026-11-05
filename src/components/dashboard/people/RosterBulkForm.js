"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { clockValue, employeeName, rosterPayload } from "@/lib/hr";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";

/**
 * Rostering several people onto the same shift across a run of days.
 *
 * The cell-by-cell grid is for fixing things; this is for publishing a week.
 * Each person is sent separately because the server scopes and validates one
 * employee at a time — a shift at the wrong branch, somebody who has left — and
 * a partial success reported honestly beats one refusal for the whole batch.
 */
export default function RosterBulkForm({ employees, shifts, from, to }) {
  const router = useRouter();
  const [form, setForm] = useState({ employeeIds: [], shiftId: "", from, to, isWeeklyOff: false });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const toggle = (id) =>
    set({ employeeIds: form.employeeIds.includes(id) ? form.employeeIds.filter((value) => value !== id) : [...form.employeeIds, id] });

  const chosenShift = shifts.find((shift) => shift.id === form.shiftId) ?? null;
  // Only staff at the shift's own branch can work it, so the list narrows once
  // a shift is picked rather than failing per person on submit.
  const eligible = chosenShift ? employees.filter((employee) => employee.branchId === chosenShift.branchId) : employees;

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    const { body, employeeIds, errors: local } = rosterPayload(form);
    setErrors(local);
    if (Object.keys(local).length) return setFormError("Some fields need attention.");

    setPending(true);
    setFormError(null);

    const failures = [];
    let done = 0;
    for (const employeeId of employeeIds) {
      try {
        await api.post("/admin/roster", { ...body, employeeId });
        done += 1;
      } catch (failure) {
        const who = employees.find((employee) => employee.id === employeeId);
        failures.push(`${employeeName(who)}: ${failure?.message ?? "refused"}`);
      }
    }

    setPending(false);
    if (done) {
      toast.success(`Rostered ${done} ${done === 1 ? "person" : "people"}.`);
      set({ employeeIds: [] });
      router.refresh();
    }
    if (failures.length) setFormError(failures.join(" · "));
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
      <p className="text-label-bold text-on-surface">Roster a run of days</p>
      <FormAlert>{formError}</FormAlert>

      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField
          id="bulk-shift"
          label="Shift"
          value={form.shiftId}
          onChange={(event) => set({ shiftId: event.target.value, employeeIds: [] })}
          options={[
            { value: "", label: "Choose a shift" },
            ...shifts.map((shift) => ({ value: shift.id, label: `${shift.name} · ${clockValue(shift.startMinute)}–${clockValue(shift.endMinute)}` })),
          ]}
          error={errors.shiftId}
        />
        <Field id="bulk-from" label="From" type="date" value={form.from} onChange={(event) => set({ from: event.target.value })} error={errors.from} />
        <Field id="bulk-to" label="Until" type="date" value={form.to} onChange={(event) => set({ to: event.target.value })} error={errors.to} hint="Inclusive. At most 62 days." />
      </div>

      <label className="flex w-fit items-center gap-2 text-body-md text-on-surface">
        <input type="checkbox" checked={form.isWeeklyOff} onChange={(event) => set({ isWeeklyOff: event.target.checked })} className="size-4 accent-primary" />
        Mark these days as off rather than worked
      </label>
      {form.isWeeklyOff ? (
        <p className="text-body-md text-on-surface-variant">
          The shift above is still named — it records what they would otherwise have worked, and the day-off flag is
          what stops them being marked absent.
        </p>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-label-bold text-on-surface">Who</legend>
        {errors.employeeIds ? <p className="text-label-bold text-error">{errors.employeeIds}</p> : null}
        {eligible.length ? (
          <>
            <button
              type="button"
              onClick={() => set({ employeeIds: form.employeeIds.length === eligible.length ? [] : eligible.map((employee) => employee.id) })}
              className="w-fit rounded-field px-3 py-1.5 text-label-bold text-primary hover:underline"
            >
              {form.employeeIds.length === eligible.length ? "Clear all" : "Select everyone"}
            </button>
            <ul className="grid gap-2 sm:grid-cols-2">
              {eligible.map((employee) => (
                <li key={employee.id}>
                  <label className={`flex cursor-pointer items-start gap-3 rounded-field p-3 ${form.employeeIds.includes(employee.id) ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-low text-on-surface hover:bg-surface-container"}`}>
                    <input type="checkbox" checked={form.employeeIds.includes(employee.id)} onChange={() => toggle(employee.id)} className="mt-1 size-4 accent-primary" />
                    <span className="min-w-0">
                      <span className="block text-label-bold">{employeeName(employee)}</span>
                      <span className="block text-body-md opacity-90">{employee.designation ?? employee.employeeCode}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-body-md text-on-surface-variant">Nobody at that shift&rsquo;s branch.</p>
        )}
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {pending ? "Rostering…" : "Roster them"}
      </button>
    </form>
  );
}
