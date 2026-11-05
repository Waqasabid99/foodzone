"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { monthName, monthRange, payrollPeriodPayload } from "@/lib/hr";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";

/**
 * Opening a pay run.
 *
 * Overlapping periods are refused by the server — they would pay the same day
 * twice. The form opens on the month just gone, because that is what is
 * actually being paid when somebody comes to this screen.
 */
export default function PayrollPeriodForm({ branches }) {
  const router = useRouter();

  const lastMonth = (() => {
    const now = new Date();
    const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const key = previous.toISOString().slice(0, 10);
    return { ...monthRange(key), name: monthName(key) };
  })();

  const [form, setForm] = useState({
    name: lastMonth.name,
    startDate: lastMonth.from,
    endDate: lastMonth.to,
    payDate: "",
    branchId: branches.length === 1 ? branches[0].id : "",
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  /** Picking a month fills the dates and the name together, so they agree. */
  function pickMonth(value) {
    if (!value) return;
    const key = `${value}-01`;
    const range = monthRange(key);
    set({ name: monthName(key), startDate: range.from, endDate: range.to });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    const { body, errors: local } = payrollPeriodPayload(form);
    setErrors(local);
    if (Object.keys(local).length) return setFormError("Some fields need attention.");

    setPending(true);
    setFormError(null);
    try {
      const created = await api.post("/admin/payroll-periods", body);
      toast.success(`${created.name} opened.`);
      router.push(`/dashboard/payroll/${created.id}`);
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be opened.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
      <p className="text-label-bold text-on-surface">Open a pay run</p>
      <FormAlert>{formError}</FormAlert>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pp-month" label="Month" type="month" value={form.startDate.slice(0, 7)} onChange={(event) => pickMonth(event.target.value)} hint="Fills the dates and the name together." />
        <Field id="pp-name" label="Name" value={form.name} onChange={(event) => set({ name: event.target.value })} error={errors.name} autoComplete="off" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="pp-from" label="Covers from" type="date" value={form.startDate} onChange={(event) => set({ startDate: event.target.value })} error={errors.startDate} />
        <Field id="pp-to" label="Until" type="date" value={form.endDate} onChange={(event) => set({ endDate: event.target.value })} error={errors.endDate} />
        <Field id="pp-pay" label="Pay day" type="date" value={form.payDate} onChange={(event) => set({ payDate: event.target.value })} error={errors.payDate} hint="Optional." />
      </div>

      {branches.length > 1 ? (
        <SelectField
          id="pp-branch"
          label="Branch"
          value={form.branchId}
          onChange={(event) => set({ branchId: event.target.value })}
          options={[{ value: "", label: "Every branch in one run" }, ...branches.map((branch) => ({ value: branch.id, label: branch.name }))]}
          hint="One run per branch keeps each outlet's wage bill on its own books."
        />
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {pending ? "Opening…" : "Open the run"}
      </button>

      <p className="text-body-md text-on-surface-variant">
        Opening it commits nothing. Payslips are generated next, and can be regenerated as often as you like while the
        run is a draft.
      </p>
    </form>
  );
}
