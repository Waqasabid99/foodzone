"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { SUPPLIER_TERMS, supplierPayload } from "@/lib/purchasing";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";

const blank = {
  code: "",
  name: "",
  contactPerson: "",
  email: "",
  phone: "",
  addressLine1: "",
  city: "",
  state: "",
  country: "",
  postalCode: "",
  taxIdentifier: "",
  paymentTermDays: "",
  creditLimit: "",
  rating: "",
  notes: "",
  isActive: true,
};

const asForm = (supplier) =>
  supplier
    ? Object.fromEntries(
        Object.entries(blank).map(([key, fallback]) => {
          const value = supplier[key];
          if (key === "isActive") return [key, value !== false];
          return [key, value == null ? fallback : String(value)];
        }),
      )
    : { ...blank };

/**
 * Who the restaurant buys from.
 *
 * Payment terms sit on the supplier rather than on each invoice because that
 * is where they are actually agreed — once, in a conversation — and every bill
 * from them inherits a due date from it. Getting it wrong here means chasing a
 * supplier who is not late, or paying one who is owed nothing yet.
 */
export default function SupplierForm({ supplier = null }) {
  const router = useRouter();
  const editing = Boolean(supplier);
  const [form, setForm] = useState(() => asForm(supplier));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    const { body, errors: local } = supplierPayload(form, { isNew: !editing });
    setErrors(local);
    if (Object.keys(local).length) return setFormError("Some fields need attention.");

    setPending(true);
    setFormError(null);
    try {
      const saved = editing
        ? await api.patch(`/admin/suppliers/${supplier.id}`, body)
        : await api.post("/admin/suppliers", body);
      toast.success(editing ? `${saved.name} saved.` : `${saved.name} added.`);
      router.push(`/dashboard/suppliers/${saved.id}`);
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be saved.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <FormAlert>{formError}</FormAlert>

      <Section title="Who they are">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="supplier-name"
            label="Name"
            value={form.name}
            onChange={(event) => set({ name: event.target.value })}
            error={errors.name}
            autoComplete="organization"
          />
          <Field
            id="supplier-code"
            label="Code"
            value={form.code}
            onChange={(event) => set({ code: event.target.value.toUpperCase() })}
            error={errors.code}
            hint="A short handle that appears on every order — FRESHCO, METRO."
            autoComplete="off"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="supplier-contact"
            label="Who to call"
            value={form.contactPerson}
            onChange={(event) => set({ contactPerson: event.target.value })}
            hint="The person who answers when a delivery is short."
            autoComplete="name"
          />
          <Field
            id="supplier-phone"
            label="Phone"
            type="tel"
            value={form.phone}
            onChange={(event) => set({ phone: event.target.value })}
            autoComplete="tel"
          />
        </div>
        <Field
          id="supplier-email"
          label="Email"
          type="email"
          value={form.email}
          onChange={(event) => set({ email: event.target.value })}
          error={errors.email}
          hint="Where a purchase order is sent."
          autoComplete="email"
        />
      </Section>

      <Section title="Where they are">
        <Field
          id="supplier-address"
          label="Address"
          value={form.addressLine1}
          onChange={(event) => set({ addressLine1: event.target.value })}
          autoComplete="street-address"
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field id="supplier-city" label="City" value={form.city} onChange={(event) => set({ city: event.target.value })} autoComplete="address-level2" />
          <Field id="supplier-state" label="Province" value={form.state} onChange={(event) => set({ state: event.target.value })} autoComplete="address-level1" />
          <Field id="supplier-country" label="Country" value={form.country} onChange={(event) => set({ country: event.target.value })} autoComplete="country-name" />
          <Field id="supplier-postal" label="Post code" value={form.postalCode} onChange={(event) => set({ postalCode: event.target.value })} autoComplete="postal-code" />
        </div>
      </Section>

      <Section
        title="Terms"
        description="What was agreed with them. Every bill from this supplier takes its due date from the payment terms, so this is the number that decides when they get chased."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="supplier-terms"
            label="Payment terms"
            value={form.paymentTermDays}
            onChange={(event) => set({ paymentTermDays: event.target.value })}
            options={[{ value: "", label: "Not agreed" }, ...SUPPLIER_TERMS.map((row) => ({ value: String(row.value), label: row.label }))]}
            error={errors.paymentTermDays}
          />
          <Field
            id="supplier-credit"
            label="Credit limit"
            inputMode="decimal"
            value={form.creditLimit}
            onChange={(event) => set({ creditLimit: event.target.value })}
            error={errors.creditLimit}
            hint="Optional. What they will let the restaurant owe at once."
            autoComplete="off"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="supplier-tax"
            label="Tax number"
            value={form.taxIdentifier}
            onChange={(event) => set({ taxIdentifier: event.target.value })}
            hint="Their NTN or sales tax registration."
            autoComplete="off"
          />
          <SelectField
            id="supplier-rating"
            label="Rating"
            value={form.rating}
            onChange={(event) => set({ rating: event.target.value })}
            options={[
              { value: "", label: "Not rated" },
              ...[5, 4, 3, 2, 1].map((score) => ({ value: String(score), label: `${score} out of 5` })),
            ]}
            error={errors.rating}
            hint="How they have actually been to deal with."
          />
        </div>
        <TextAreaField
          id="supplier-notes"
          label="Notes"
          rows={3}
          value={form.notes}
          onChange={(event) => set({ notes: event.target.value })}
          placeholder="Delivery days, minimum order, who to ask for"
        />
        <label htmlFor="supplier-active" className="flex items-center gap-3 rounded-field bg-surface-container-low px-4 py-3 text-body-md text-on-surface">
          <input
            id="supplier-active"
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => set({ isActive: event.target.checked })}
            className="size-4 accent-primary"
          />
          <span>
            Buying from them
            <span className="block text-label-bold font-normal text-on-surface-variant">
              Turn this off to stop them appearing on new orders. Their history stays.
            </span>
          </span>
        </label>
      </Section>

      <div className="min-w-48 max-w-xs">
        <SubmitButton pending={pending} pendingLabel="Saving…">{editing ? "Save supplier" : "Add supplier"}</SubmitButton>
      </div>
    </form>
  );
}
