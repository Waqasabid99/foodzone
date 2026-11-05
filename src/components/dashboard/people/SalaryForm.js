"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { SALARY_TYPES, salaryPayload } from "@/lib/hr";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";

/**
 * What somebody is paid.
 *
 * Behind `employees.manage_salary` and always audited with the before and
 * after — a pay change is exactly what an audit trail is for, and "the salary
 * field was edited" answers none of the questions anybody asks afterwards.
 */
export default function SalaryForm({ employee, currency }) {
  const router = useRouter();
  const [form, setForm] = useState({
    salaryType: employee.salaryType ?? "MONTHLY",
    baseSalary: String(employee.baseSalary ?? 0),
    hourlyRate: employee.hourlyRate == null ? "" : String(employee.hourlyRate),
    overtimeMultiplier: String(employee.overtimeMultiplier ?? 1.5),
    bankAccountName: employee.bankAccountName ?? "",
    bankAccountNumber: employee.bankAccountNumber ?? "",
    bankIfsc: employee.bankIfsc ?? "",
    taxIdentifier: employee.taxIdentifier ?? "",
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    const { body, errors: local } = salaryPayload(form);
    setErrors(local);
    if (Object.keys(local).length) return setFormError("Some fields need attention.");

    setPending(true);
    setFormError(null);
    try {
      await api.put(`/admin/employees/${employee.id}/salary`, body);
      toast.success("Pay updated.");
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be saved.");
    } finally {
      setPending(false);
    }
  }

  const basis = SALARY_TYPES[form.salaryType] ?? SALARY_TYPES.MONTHLY;

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <FormAlert>{formError}</FormAlert>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          id="pay-type"
          label="Paid"
          value={form.salaryType}
          onChange={(event) => set({ salaryType: event.target.value })}
          options={Object.entries(SALARY_TYPES).map(([value, type]) => ({ value, label: type.label }))}
          hint={basis.hint}
          error={errors.salaryType}
        />
        <Field
          id="pay-base"
          label={form.salaryType === "MONTHLY" ? "Monthly salary" : "Base amount"}
          type="number"
          step="0.01"
          min="0"
          value={form.baseSalary}
          onChange={(event) => set({ baseSalary: event.target.value })}
          error={errors.baseSalary}
          hint={`In ${currency}.`}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="pay-hourly"
          label="Hourly rate"
          type="number"
          step="0.01"
          min="0"
          value={form.hourlyRate}
          onChange={(event) => set({ hourlyRate: event.target.value })}
          error={errors.hourlyRate}
          hint={form.salaryType === "HOURLY" ? "Required — this is how they are paid." : "Used for overtime."}
        />
        <Field
          id="pay-ot"
          label="Overtime multiplier"
          type="number"
          step="0.1"
          min="1"
          max="5"
          value={form.overtimeMultiplier}
          onChange={(event) => set({ overtimeMultiplier: event.target.value })}
          error={errors.overtimeMultiplier}
          hint="1.5 is time and a half."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pay-bank-name" label="Account name" value={form.bankAccountName} onChange={(event) => set({ bankAccountName: event.target.value })} error={errors.bankAccountName} autoComplete="off" />
        <Field id="pay-bank-number" label="Account number" value={form.bankAccountNumber} onChange={(event) => set({ bankAccountNumber: event.target.value })} error={errors.bankAccountNumber} autoComplete="off" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pay-ifsc" label="Bank code" value={form.bankIfsc} onChange={(event) => set({ bankIfsc: event.target.value })} error={errors.bankIfsc} hint="IFSC, sort code, routing number." autoComplete="off" />
        <Field id="pay-tax" label="Tax identifier" value={form.taxIdentifier} onChange={(event) => set({ taxIdentifier: event.target.value })} error={errors.taxIdentifier} autoComplete="off" />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {pending ? "Saving…" : "Save pay"}
      </button>
      <p className="text-body-md text-on-surface-variant">Recorded in the audit trail, with what it was before.</p>
    </form>
  );
}
