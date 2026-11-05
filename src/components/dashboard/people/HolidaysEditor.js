"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { dayKey, dayLabel, holidayPayload } from "@/lib/hr";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";
import Chip from "@/components/dashboard/inventory/Chip";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The closure calendar.
 *
 * A holiday with no branch is company-wide; one pinned to a branch closes only
 * that outlet, which is what a local festival or a refit needs.
 *
 * Attendance derivation reads this: on a holiday, somebody who did not turn up
 * is marked HOLIDAY rather than absent, and a paid holiday still pays.
 */
export default function HolidaysEditor({ holidays, branches, canManage }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", date: today(), branchId: "", isPaid: true });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const branchName = (id) => branches.find((branch) => branch.id === id)?.name ?? "One branch";

  async function create(event) {
    event.preventDefault();
    if (pending) return;

    const { body, errors: local } = holidayPayload(form);
    setErrors(local);
    if (Object.keys(local).length) return setFormError("Some fields need attention.");

    setPending(true);
    setFormError(null);
    try {
      await api.post("/admin/holidays", body);
      toast.success(`${body.name} added.`);
      setForm({ ...form, name: "" });
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be added.");
    } finally {
      setPending(false);
    }
  }

  async function remove(holiday) {
    if (busyId) return;
    if (!window.confirm(`Take ${holiday.name} off the calendar? Attendance already derived for that day keeps what it says until it is rebuilt.`)) return;

    setBusyId(holiday.id);
    setFormError(null);
    try {
      await api.delete(`/admin/holidays/${holiday.id}`);
      toast.success(`${holiday.name} removed.`);
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be removed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <FormAlert>{formError}</FormAlert>

      {holidays.length ? (
        <ul className="flex flex-col gap-2">
          {holidays.map((holiday) => (
            <li key={holiday.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low px-4 py-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-label-bold text-on-surface">{holiday.name}</span>
                  {holiday.branchId ? <Chip>{branchName(holiday.branchId)}</Chip> : <Chip tone="bg-secondary-container text-on-secondary-container">Every branch</Chip>}
                  {holiday.isPaid ? null : <Chip tone="bg-warning-container text-on-warning-container">Unpaid</Chip>}
                </p>
                <p className="mt-0.5 text-body-md text-on-surface-variant">{dayLabel(dayKey(holiday.date))}</p>
              </div>
              {canManage ? (
                <button
                  type="button"
                  onClick={() => remove(holiday)}
                  disabled={busyId === holiday.id}
                  className="rounded-field px-3 py-1.5 text-label-bold text-error hover:bg-error-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {busyId === holiday.id ? "Removing…" : "Remove"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-md text-on-surface-variant">
          Nothing on the calendar for this year. Without it, a closure day reads as everybody being absent.
        </p>
      )}

      {canManage ? (
        <form onSubmit={create} noValidate className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
          <p className="text-label-bold text-on-surface">Add a day</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="hol-name" label="What is it called" value={form.name} onChange={(event) => set({ name: event.target.value })} error={errors.name} placeholder="Eid al-Fitr" autoComplete="off" />
            <Field id="hol-date" label="Date" type="date" value={form.date} onChange={(event) => set({ date: event.target.value })} error={errors.date} />
          </div>

          <SelectField
            id="hol-branch"
            label="Where"
            value={form.branchId}
            onChange={(event) => set({ branchId: event.target.value })}
            options={[
              { value: "", label: "Every branch" },
              ...branches.map((branch) => ({ value: branch.id, label: `${branch.name} only` })),
            ]}
            hint="Most holidays are company-wide. Pin one to a branch for a local closure."
          />

          <label className="flex w-fit items-center gap-2 text-body-md text-on-surface">
            <input type="checkbox" checked={form.isPaid} onChange={(event) => set({ isPaid: event.target.checked })} className="size-4 accent-primary" />
            Paid
          </label>

          <button
            type="submit"
            disabled={pending}
            className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {pending ? "Adding…" : "Add holiday"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
