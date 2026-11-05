"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { leaveTypePayload } from "@/lib/hr";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";
import Chip from "@/components/dashboard/inventory/Chip";

const blank = () => ({ name: "", code: "", isPaid: true, annualQuota: "0", carryForward: false });

/**
 * The kinds of leave, and how many days each one grants a year.
 *
 * A quota of zero means no yearly limit — sick leave, in many places — rather
 * than "none allowed", which is what a bare zero would otherwise read as.
 *
 * Carrying forward rolls whatever is unused into next year's opening balance.
 */
export default function LeaveTypesEditor({ leaveTypes, canManage }) {
  const router = useRouter();
  const [form, setForm] = useState(blank());
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  async function create(event) {
    event.preventDefault();
    if (pending) return;

    const { body, errors: local } = leaveTypePayload(form);
    setErrors(local);
    if (Object.keys(local).length) return setFormError("Some fields need attention.");

    setPending(true);
    setFormError(null);
    try {
      await api.post("/admin/leave-types", body);
      toast.success(`${body.name} added.`);
      setForm(blank());
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be added.");
    } finally {
      setPending(false);
    }
  }

  async function toggle(type) {
    if (busyId) return;
    setBusyId(type.id);
    setFormError(null);
    try {
      await api.patch(`/admin/leave-types/${type.id}`, { isActive: !type.isActive });
      toast.success(type.isActive ? `${type.name} retired.` : `${type.name} is back.`);
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "That did not work.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {leaveTypes.length ? (
        <ul className="flex flex-col gap-2">
          {leaveTypes.map((type) => (
            <li key={type.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low px-4 py-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-label-bold text-on-surface">{type.name}</span>
                  <Chip>{type.code}</Chip>
                  {type.isPaid ? null : <Chip tone="bg-warning-container text-on-warning-container">Unpaid</Chip>}
                  {type.isActive ? null : <Chip>Retired</Chip>}
                </p>
                <p className="mt-0.5 text-body-md text-on-surface-variant">
                  {Number(type.annualQuota) > 0 ? `${Number(type.annualQuota)} days a year` : "No yearly limit"}
                  {type.carryForward ? " · unused days carry over" : ""}
                  {type.requestCount ? ` · used ${type.requestCount} times` : ""}
                </p>
              </div>
              {canManage ? (
                <button
                  type="button"
                  onClick={() => toggle(type)}
                  disabled={busyId === type.id}
                  className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {busyId === type.id ? "Working…" : type.isActive ? "Retire" : "Bring back"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-md text-on-surface-variant">
          No leave types yet. Without at least one, nobody can request leave and every absence reads as unexplained.
        </p>
      )}

      {canManage ? (
        <form onSubmit={create} noValidate className="flex flex-col gap-4 rounded-field bg-surface-container-low p-4">
          <p className="text-label-bold text-on-surface">Add a kind of leave</p>
          <FormAlert>{formError}</FormAlert>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="lt-name" label="Name" value={form.name} onChange={(event) => set({ name: event.target.value })} error={errors.name} placeholder="Annual" autoComplete="off" />
            <Field id="lt-code" label="Code" value={form.code} onChange={(event) => set({ code: event.target.value.toUpperCase() })} error={errors.code} placeholder="AL" autoComplete="off" />
            <Field id="lt-quota" label="Days a year" type="number" min="0" max="365" step="0.5" value={form.annualQuota} onChange={(event) => set({ annualQuota: event.target.value })} error={errors.annualQuota} hint="Zero means no limit." />
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-body-md text-on-surface">
              <input type="checkbox" checked={form.isPaid} onChange={(event) => set({ isPaid: event.target.checked })} className="size-4 accent-primary" />
              Paid
            </label>
            <label className="flex items-center gap-2 text-body-md text-on-surface">
              <input type="checkbox" checked={form.carryForward} onChange={(event) => set({ carryForward: event.target.checked })} className="size-4 accent-primary" />
              Unused days carry into next year
            </label>
          </div>

          <button
            type="submit"
            disabled={pending}
            className="w-fit rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {pending ? "Adding…" : "Add leave type"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
