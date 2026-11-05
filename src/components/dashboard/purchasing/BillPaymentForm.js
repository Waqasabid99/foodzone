"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { PAYMENT_METHODS, billPaymentPayload, dayKey } from "@/lib/purchasing";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";

/**
 * Recording money leaving.
 *
 * The amount opens on what is outstanding, because paying a bill in full is
 * the ordinary case and retyping the figure is how a digit gets dropped. Part
 * payments are simply a smaller number.
 *
 * Overpayment is refused here as well as on the server. It is nearly always a
 * duplicate of a payment already recorded, and letting it through creates a
 * negative payable that quietly understates what the restaurant owes across
 * every supplier.
 */
export default function BillPaymentForm({ bill, outstanding, currency, accounts }) {
  const router = useRouter();
  const [form, setForm] = useState({
    amount: String(outstanding ?? ""),
    paidAt: dayKey(),
    accountId: accounts.length === 1 ? accounts[0].id : "",
    method: "BANK_TRANSFER",
    reference: "",
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    const { body, errors: local } = billPaymentPayload(form, { outstanding });
    setErrors(local);
    if (Object.keys(local).length) return setFormError("Some fields need attention.");

    setPending(true);
    setFormError(null);
    try {
      await api.post(`/admin/supplier-bills/${bill.id}/payments`, body);
      toast.success(`${formatMoney(body.amount, currency)} recorded.`);
      set({ amount: "", reference: "" });
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be recorded.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
      <div>
        <h2 className="font-display text-headline-md text-on-surface">Record a payment</h2>
        <p className="mt-1 text-body-md text-on-surface-variant">
          {formatMoney(outstanding, currency)} still outstanding on {bill.billNumber}.
        </p>
      </div>

      <FormAlert>{formError}</FormAlert>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="pay-amount"
          label="Amount"
          inputMode="decimal"
          value={form.amount}
          onChange={(event) => set({ amount: event.target.value })}
          error={errors.amount}
          autoComplete="off"
        />
        <Field id="pay-date" label="Paid on" type="date" value={form.paidAt} onChange={(event) => set({ paidAt: event.target.value })} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          id="pay-method"
          label="How"
          value={form.method}
          onChange={(event) => set({ method: event.target.value })}
          options={Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label }))}
          error={errors.method}
        />
        <SelectField
          id="pay-account"
          label="Out of"
          value={form.accountId}
          onChange={(event) => set({ accountId: event.target.value })}
          options={[
            { value: "", label: "Not recorded" },
            ...accounts.map((account) => ({ value: account.id, label: `${account.code} — ${account.name}` })),
          ]}
          hint="The cash or bank account the money came from."
        />
      </div>

      <Field
        id="pay-reference"
        label="Reference"
        value={form.reference}
        onChange={(event) => set({ reference: event.target.value })}
        hint="Cheque number, transfer reference — what to search for if it is queried."
        autoComplete="off"
      />

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {pending ? "Recording…" : "Record payment"}
      </button>
    </form>
  );
}
