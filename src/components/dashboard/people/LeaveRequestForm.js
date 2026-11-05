"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { employeeName, leavePayload } from "@/lib/hr";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import FormAlert from "@/components/ui/FormAlert";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Booking leave on somebody's behalf.
 *
 * Overlapping requests are refused by the server: two approved leaves over one
 * day would each consume a day of balance while the person is only absent
 * once, and attendance derivation would have to pick one arbitrarily.
 *
 * Nothing here consumes balance. Approval does — see the review buttons.
 */
export default function LeaveRequestForm({ employees, leaveTypes }) {
  const router = useRouter();
  const [form, setForm] = useState({
    employeeId: "",
    leaveTypeId: "",
    startDate: today(),
    endDate: today(),
    halfDay: false,
    reason: "",
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const days = useMemo(() => {
    if (form.halfDay) return 0.5;
    if (!form.startDate || !form.endDate) return 0;
    const from = new Date(`${form.startDate}T00:00:00Z`);
    const to = new Date(`${form.endDate}T00:00:00Z`);
    return Math.max(0, Math.floor((to - from) / 86_400_000) + 1);
  }, [form.startDate, form.endDate, form.halfDay]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    const { body, errors: local } = leavePayload(form);
    setErrors(local);
    if (Object.keys(local).length) return setFormError("Some fields need attention.");

    setPending(true);
    setFormError(null);
    try {
      await api.post("/admin/leave-requests", body);
      toast.success("Leave requested.");
      setForm({ ...form, reason: "", employeeId: "" });
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be requested.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <FormAlert>{formError}</FormAlert>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          id="leave-employee"
          label="Who"
          value={form.employeeId}
          onChange={(event) => set({ employeeId: event.target.value })}
          options={[
            { value: "", label: "Choose someone" },
            ...employees.map((employee) => ({ value: employee.id, label: `${employeeName(employee)} — ${employee.employeeCode}` })),
          ]}
          error={errors.employeeId}
        />
        <SelectField
          id="leave-type"
          label="Kind of leave"
          value={form.leaveTypeId}
          onChange={(event) => set({ leaveTypeId: event.target.value })}
          options={[
            { value: "", label: "Choose a type" },
            ...leaveTypes.map((type) => ({ value: type.id, label: `${type.name}${type.isPaid ? "" : " (unpaid)"}` })),
          ]}
          error={errors.leaveTypeId}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="leave-from" label="From" type="date" value={form.startDate} onChange={(event) => set({ startDate: event.target.value, ...(form.halfDay ? { endDate: event.target.value } : {}) })} error={errors.startDate} />
        <Field id="leave-to" label="Until" type="date" value={form.endDate} onChange={(event) => set({ endDate: event.target.value })} error={errors.endDate} disabled={form.halfDay} hint="Inclusive." />
      </div>

      <label className="flex w-fit items-center gap-2 text-body-md text-on-surface">
        <input
          type="checkbox"
          checked={form.halfDay}
          onChange={(event) => set({ halfDay: event.target.checked, endDate: event.target.checked ? form.startDate : form.endDate })}
          className="size-4 accent-primary"
        />
        Half a day
      </label>

      <TextAreaField id="leave-reason" label="Reason" rows={2} value={form.reason} onChange={(event) => set({ reason: event.target.value })} error={errors.reason} hint="Optional." />

      <p className="text-body-md text-on-surface-variant" aria-live="polite">
        {days ? `${days} ${days === 1 ? "day" : "days"}.` : "Choose the dates."} Nothing comes off their balance until
        this is approved.
      </p>

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {pending ? "Requesting…" : "Request leave"}
      </button>
    </form>
  );
}
