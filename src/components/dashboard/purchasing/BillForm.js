"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { addAmounts, dayKey, supplierBillPayload } from "@/lib/purchasing";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";

/** Days after the invoice date, from the supplier's agreed terms. */
function dueFrom(billDate, termDays) {
  if (!billDate || termDays == null) return "";
  const date = new Date(`${billDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + termDays);
  return date.toISOString().slice(0, 10);
}

/**
 * Transcribing a supplier's invoice.
 *
 * This is the one document the restaurant does not author — it is copying out
 * what somebody else sent — so the totals are typed rather than derived. What
 * the form does instead is check they add up, and fill the due date from the
 * terms agreed with that supplier, because a due date invented per invoice is
 * how a supplier ends up chased early or paid late.
 *
 * Most bills should not be typed here at all. A delivery that has been posted
 * already knows its own amounts, and billing from the receipt copies them
 * across — see the unbilled deliveries on the bills page.
 */
export default function BillForm({ branches, suppliers, receipt = null }) {
  const router = useRouter();

  const [form, setForm] = useState(() => ({
    supplierId: receipt?.supplier?.id ?? "",
    branchId: receipt?.branchId ?? (branches.length === 1 ? branches[0].id : ""),
    goodsReceiptId: receipt?.id ?? "",
    supplierInvoiceNumber: receipt?.supplierInvoiceNumber ?? "",
    billDate: dayKey(),
    dueDate: "",
    subtotal: "",
    taxTotal: "",
    notes: "",
  }));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const supplier = suppliers.find((row) => row.id === form.supplierId);
  const currency = branches.find((row) => row.id === form.branchId)?.currency ?? "PKR";
  const total = addAmounts(form.subtotal, form.taxTotal);

  /** Changing the supplier or the invoice date re-derives the due date. */
  function reprice(patch) {
    const next = { ...form, ...patch };
    const terms = suppliers.find((row) => row.id === next.supplierId)?.paymentTermDays;
    set({ ...patch, dueDate: dueFrom(next.billDate, terms ?? null) || next.dueDate });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    const { body, errors: local } = supplierBillPayload(form);
    setErrors(local);
    if (Object.keys(local).length) return setFormError("Some fields need attention.");

    setPending(true);
    setFormError(null);
    try {
      const created = await api.post("/admin/supplier-bills", body);
      toast.success(`${created.billNumber} recorded.`);
      router.push(`/dashboard/supplier-bills/${created.id}`);
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be saved.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <FormAlert>{formError}</FormAlert>

      <Section title="Whose invoice">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="bill-supplier"
            label="Supplier"
            value={form.supplierId}
            onChange={(event) => reprice({ supplierId: event.target.value })}
            options={[{ value: "", label: "Choose a supplier" }, ...suppliers.map((row) => ({ value: row.id, label: row.name }))]}
            error={errors.supplierId}
            disabled={Boolean(receipt)}
          />
          {branches.length > 1 || receipt ? (
            <SelectField
              id="bill-branch"
              label="Branch"
              value={form.branchId}
              onChange={(event) => set({ branchId: event.target.value })}
              options={[{ value: "", label: "Choose a branch" }, ...branches.map((row) => ({ value: row.id, label: row.name }))]}
              error={errors.branchId}
              disabled={Boolean(receipt)}
              hint="Whose books the payable lands on."
            />
          ) : null}
        </div>
        <Field
          id="bill-invoice"
          label="Their invoice number"
          value={form.supplierInvoiceNumber}
          onChange={(event) => set({ supplierInvoiceNumber: event.target.value })}
          hint="What to quote when querying it."
          autoComplete="off"
        />
      </Section>

      <Section title="Dates">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="bill-date"
            label="Invoice date"
            type="date"
            value={form.billDate}
            onChange={(event) => reprice({ billDate: event.target.value })}
          />
          <Field
            id="bill-due"
            label="Due"
            type="date"
            value={form.dueDate}
            onChange={(event) => set({ dueDate: event.target.value })}
            error={errors.dueDate}
            hint={
              supplier?.paymentTermDays != null
                ? `Filled from the ${supplier.paymentTermDays}-day terms agreed with ${supplier.name}.`
                : "No terms agreed with this supplier, so set it by hand."
            }
          />
        </div>
      </Section>

      <Section title="What it comes to" description="Copied off the invoice rather than worked out here — this is their document, not the restaurant's.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="bill-subtotal"
            label="Goods"
            inputMode="decimal"
            value={form.subtotal}
            onChange={(event) => set({ subtotal: event.target.value })}
            error={errors.subtotal}
            autoComplete="off"
          />
          <Field
            id="bill-tax"
            label="Tax"
            inputMode="decimal"
            value={form.taxTotal}
            onChange={(event) => set({ taxTotal: event.target.value })}
            error={errors.taxTotal}
            hint="Optional."
            autoComplete="off"
          />
        </div>
        <p className="rounded-field bg-surface-container px-4 py-3 text-body-md text-on-surface">
          Total owed <strong className="tabular-nums">{formatMoney(total, currency)}</strong>
        </p>
        <TextAreaField id="bill-notes" label="Note" rows={2} value={form.notes} onChange={(event) => set({ notes: event.target.value })} />
      </Section>

      <div className="min-w-48 max-w-xs">
        <SubmitButton pending={pending} pendingLabel="Saving…">Record the bill</SubmitButton>
      </div>
      <p className="text-body-md text-on-surface-variant">
        A recorded bill is a draft, not a payable. Nothing reaches the ledger until somebody approves it, which is the
        point at which the restaurant agrees it owes the money.
      </p>
    </form>
  );
}
