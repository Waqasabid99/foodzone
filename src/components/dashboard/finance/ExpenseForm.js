"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import FormAlert from "@/components/ui/FormAlert";
import { expenseNet, expensePayload, toDateInput } from "@/lib/finance";

/**
 * Recording operating spend that is not a supplier bill: utilities, fuel,
 * repairs, the plumber.
 *
 * The total off the receipt is entered as one figure, with the tax inside it
 * named separately. That is the shape the ledger wants — the posting rule
 * books the total less the tax as the cost and the tax as recoverable — and
 * it is also what the piece of paper in somebody's hand actually says. Asking
 * for a net figure instead means whoever is typing has to do the subtraction,
 * and every time they get it wrong the cost is understated by the difference.
 *
 * Saved as a draft. It becomes a cost in the ledger when it is approved, not
 * when it is typed — otherwise anyone who can type could move the P&L.
 */
export default function ExpenseForm({ expense = null, branches, categories, accounts, defaultBranchId = "" }) {
  const router = useRouter();
  const [form, setForm] = useState(() => ({
    branchId: expense?.branchId ?? defaultBranchId ?? branches[0]?.id ?? "",
    categoryId: expense?.categoryId ?? "",
    paidFromId: expense?.paidFromId ?? "",
    payee: expense?.payee ?? "",
    description: expense?.description ?? "",
    amount: expense ? String(expense.amount) : "",
    taxAmount: expense ? String(expense.taxAmount ?? "") : "",
    expenseDate: toDateInput(expense?.expenseDate ?? new Date()),
    receiptUrl: expense?.receiptUrl ?? "",
  }));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const net = expenseNet({ amount: form.amount || 0, taxAmount: form.taxAmount || 0 });
  const taxTooBig = Number(form.taxAmount || 0) > Number(form.amount || 0);
  const ready = form.branchId && form.amount !== "" && Number(form.amount) > 0 && form.expenseDate && !taxTooBig;

  async function submit(event) {
    event.preventDefault();
    if (pending || !ready) return;

    setPending(true);
    setError(null);
    try {
      const payload = expensePayload(form);
      if (expense) {
        await api.patch(`/admin/expenses/${expense.id}`, payload);
        toast.success("Saved.");
        router.push(`/dashboard/expenses/${expense.id}`);
      } else {
        const created = await api.post("/admin/expenses", payload);
        toast.success("Recorded as a draft.");
        router.push(`/dashboard/expenses/${created.id}`);
      }
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-5">
      <FormAlert>{error}</FormAlert>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          id="expense-branch"
          label="Branch"
          value={form.branchId}
          onChange={(event) => setForm((state) => ({ ...state, branchId: event.target.value }))}
          options={branches.map((row) => ({ value: row.id, label: row.name }))}
          hint="Whose cost this is. It shows in that branch's profit and loss."
          required
        />
        <Field
          id="expense-date"
          label="Date"
          type="date"
          value={form.expenseDate}
          onChange={(event) => setForm((state) => ({ ...state, expenseDate: event.target.value }))}
          required
        />
      </div>

      <SelectField
        id="expense-category"
        label="Category"
        value={form.categoryId}
        onChange={(event) => setForm((state) => ({ ...state, categoryId: event.target.value }))}
        options={[{ value: "", label: "Uncategorised" }, ...categories.map((row) => ({ value: row.id, label: row.name }))]}
        hint="Decides which expense account it posts to, and how it groups in a report."
      />

      <Field
        id="expense-payee"
        label="Who was paid"
        value={form.payee}
        onChange={(event) => setForm((state) => ({ ...state, payee: event.target.value }))}
        autoComplete="off"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="expense-amount"
          label="Total off the receipt"
          type="number"
          step="0.01"
          min="0"
          value={form.amount}
          onChange={(event) => setForm((state) => ({ ...state, amount: event.target.value }))}
          hint="The whole figure that left the bank, tax included."
          autoComplete="off"
          required
        />
        <Field
          id="expense-tax"
          label="Of which tax"
          type="number"
          step="0.01"
          min="0"
          value={form.taxAmount}
          onChange={(event) => setForm((state) => ({ ...state, taxAmount: event.target.value }))}
          error={taxTooBig ? "The tax cannot be more than the total it is part of." : null}
          hint="Part of the total above, not on top of it. Named separately because it may be recoverable and a cost is not."
          autoComplete="off"
        />
      </div>

      {form.amount !== "" && !taxTooBig ? (
        <p className="rounded-field bg-surface-container-low px-4 py-3 text-body-md text-on-surface" aria-live="polite">
          The cost is <span className="tabular-nums text-label-bold">{formatMoney(net)}</span>, with{" "}
          {formatMoney(form.taxAmount || 0)} of tax inside the {formatMoney(form.amount)} total.
        </p>
      ) : null}

      <SelectField
        id="expense-paid-from"
        label="Paid from"
        value={form.paidFromId}
        onChange={(event) => setForm((state) => ({ ...state, paidFromId: event.target.value }))}
        options={[{ value: "", label: "Not recorded" }, ...accounts.map((row) => ({ value: row.id, label: `${row.code} — ${row.name}` }))]}
        hint="Which account the money came out of."
      />

      <TextAreaField
        id="expense-description"
        label="What it was for"
        value={form.description}
        onChange={(event) => setForm((state) => ({ ...state, description: event.target.value }))}
        rows={3}
      />

      <Field
        id="expense-receipt"
        label="Receipt link"
        type="url"
        value={form.receiptUrl}
        onChange={(event) => setForm((state) => ({ ...state, receiptUrl: event.target.value }))}
        hint="Optional, and the first thing anyone approving this will look for."
        autoComplete="off"
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || !ready}
          className="rounded-field bg-primary-container px-6 py-3 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {pending ? "Saving…" : expense ? "Save changes" : "Record it"}
        </button>
        <p className="text-body-md text-on-surface-variant">
          {expense ? "Only a draft can be edited." : "Saved as a draft. It becomes a cost in the books once approved."}
        </p>
      </div>
    </form>
  );
}
