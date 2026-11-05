"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { componentPayload } from "@/lib/hr";
import { formatMoney } from "@/lib/format";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";
import Chip from "@/components/dashboard/inventory/Chip";

const today = () => new Date().toISOString().slice(0, 10);

const blank = () => ({
  name: "",
  isEarning: true,
  basis: "AMOUNT",
  amount: "",
  percentOfBase: "",
  isTaxable: true,
  accountId: "",
  effectiveFrom: today(),
  effectiveTo: "",
});

/**
 * The lines that repeat every cycle: a housing allowance, a provident fund, an
 * advance being repaid.
 *
 * A component is **ended, never deleted**. A payslip already generated
 * referenced it, and removing the row would leave that payslip unable to
 * explain one of its own lines.
 */
export default function SalaryComponents({ employee, components, currency, deductionAccounts = [] }) {
  const router = useRouter();
  const [form, setForm] = useState(blank());
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const [ending, setEnding] = useState(null);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const now = today();
  const live = components.filter((row) => !row.effectiveTo || String(row.effectiveTo).slice(0, 10) >= now);
  const past = components.filter((row) => row.effectiveTo && String(row.effectiveTo).slice(0, 10) < now);

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    const { body, errors: local } = componentPayload(form);
    setErrors(local);
    if (Object.keys(local).length) return setFormError("Some fields need attention.");

    setPending(true);
    setFormError(null);
    try {
      await api.post(`/admin/employees/${employee.id}/components`, body);
      toast.success(`${body.name} added.`);
      setForm(blank());
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be added.");
    } finally {
      setPending(false);
    }
  }

  async function end(component) {
    if (ending) return;
    if (!window.confirm(`Stop ${component.name} from today? Payslips already generated keep it.`)) return;
    setEnding(component.id);
    try {
      await api.delete(`/admin/employees/${employee.id}/components/${component.id}`);
      toast.success(`${component.name} ended.`);
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be ended.");
    } finally {
      setEnding(null);
    }
  }

  const describe = (component) =>
    component.amount != null
      ? formatMoney(component.amount, currency)
      : `${Number(component.percentOfBase)}% of base`;

  return (
    <div className="flex flex-col gap-5">
      {live.length ? (
        <ul className="flex flex-col gap-2">
          {live.map((component) => (
            <li key={component.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low px-4 py-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-label-bold text-on-surface">{component.name}</span>
                  <Chip tone={component.isEarning ? "bg-success-container text-on-success-container" : "bg-error-container text-on-error-container"}>
                    {component.isEarning ? "Earning" : "Deduction"}
                  </Chip>
                  {component.isTaxable ? null : <Chip>Not taxable</Chip>}
                  {component.account ? <Chip>{component.account.code}</Chip> : null}
                </p>
                <p className="mt-0.5 text-body-md text-on-surface-variant">
                  {describe(component)} · from {String(component.effectiveFrom).slice(0, 10)}
                  {component.effectiveTo ? ` until ${String(component.effectiveTo).slice(0, 10)}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => end(component)}
                disabled={ending === component.id}
                className="rounded-field px-3 py-1.5 text-label-bold text-error hover:bg-error-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {ending === component.id ? "Ending…" : "End it"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-md text-on-surface-variant">Nothing recurring. Their pay is the base amount alone.</p>
      )}

      {past.length ? (
        <details className="rounded-field bg-surface-container-low px-4 py-3">
          <summary className="cursor-pointer text-label-bold text-on-surface">{past.length} ended</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {past.map((component) => (
              <li key={component.id} className="text-body-md text-on-surface-variant">
                {component.name} — {describe(component)}, ended {String(component.effectiveTo).slice(0, 10)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 rounded-field bg-surface-container-low p-4">
        <p className="text-label-bold text-on-surface">Add one</p>
        <FormAlert>{formError}</FormAlert>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="comp-name" label="What it is called" value={form.name} onChange={(event) => set({ name: event.target.value })} error={errors.name} hint="This is the line on their payslip." autoComplete="off" />
          <SelectField
            id="comp-kind"
            label="Kind"
            value={form.isEarning ? "EARNING" : "DEDUCTION"}
            onChange={(event) => set({ isEarning: event.target.value === "EARNING" })}
            options={[{ value: "EARNING", label: "Earning — added to pay" }, { value: "DEDUCTION", label: "Deduction — taken off" }]}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="comp-basis"
            label="Worked out as"
            value={form.basis}
            onChange={(event) => set({ basis: event.target.value })}
            options={[{ value: "AMOUNT", label: "A fixed amount" }, { value: "PERCENT", label: "A percentage of base pay" }]}
            hint="One or the other. A component that is both is ambiguous."
          />
          {form.basis === "AMOUNT" ? (
            <Field id="comp-amount" label="Amount" type="number" step="0.01" min="0" value={form.amount} onChange={(event) => set({ amount: event.target.value })} error={errors.amount} hint={`In ${currency}.`} />
          ) : (
            <Field id="comp-percent" label="Percent of base" type="number" step="0.1" min="0" max="100" value={form.percentOfBase} onChange={(event) => set({ percentOfBase: event.target.value })} error={errors.percentOfBase} />
          )}
        </div>

        {!form.isEarning && deductionAccounts.length ? (
          <SelectField
            id="comp-account"
            label="Where it goes in the ledger"
            value={form.accountId}
            onChange={(event) => set({ accountId: event.target.value })}
            options={[
              { value: "", label: "Employee deductions payable (default)" },
              ...deductionAccounts.map((account) => ({ value: account.id, label: `${account.code} ${account.name}` })),
            ]}
            hint="Tax to the tax account, a fund to the fund, an advance against what the employee already owes."
          />
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="comp-from" label="From" type="date" value={form.effectiveFrom} onChange={(event) => set({ effectiveFrom: event.target.value })} error={errors.effectiveFrom} />
          <Field id="comp-to" label="Until" type="date" value={form.effectiveTo} onChange={(event) => set({ effectiveTo: event.target.value })} error={errors.effectiveTo} hint="Leave empty to run indefinitely." />
        </div>

        <label className="flex w-fit items-center gap-2 text-body-md text-on-surface">
          <input type="checkbox" checked={form.isTaxable} onChange={(event) => set({ isTaxable: event.target.checked })} className="size-4 accent-primary" />
          Taxable
        </label>

        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {pending ? "Adding…" : "Add component"}
        </button>
      </form>
    </div>
  );
}
