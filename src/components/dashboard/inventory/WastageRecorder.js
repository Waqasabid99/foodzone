"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import { toFormErrors } from "@/lib/form-errors";
import { RECORDABLE_WASTAGE_REASONS, formatQuantity, wastagePayload } from "@/lib/inventory";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";
import ItemSelect from "@/components/dashboard/inventory/ItemSelect";

/**
 * Records waste as it happens. It leaves stock at once — the food is already
 * in the bin — and a manager reviews it afterwards.
 */
export default function WastageRecorder({ locations, items, levels, defaultItemId = "", startOpen = false }) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen);
  const blank = () => ({
    locationId: locations.length === 1 ? locations[0].id : "",
    itemId: defaultItemId,
    reason: "",
    quantity: "",
    notes: "",
  });
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const item = items.find((row) => row.id === form.itemId);
  const reason = RECORDABLE_WASTAGE_REASONS.find((row) => row.value === form.reason);
  const onHand = form.locationId && form.itemId ? levels[`${form.locationId}:${form.itemId}`] ?? "0" : null;
  const multiBranch = new Set(locations.map((location) => location.branchId)).size > 1;

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const { body, errors: local } = wastagePayload(form);
    if (Object.keys(local).length) return setErrors(local);
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      await api.post("/admin/wastage", body);
      toast.success(`${formatQuantity(body.quantity, { precision: item?.uom.precision ?? 3, unit: item?.uom.code })} of ${item?.name ?? "stock"} recorded as waste.`);
      setForm({ ...blank(), locationId: form.locationId });
      router.refresh();
    } catch (failure) {
      const mapped = toFormErrors(failure, { fields: ["locationId", "itemId", "reason", "quantity", "notes"] });
      setErrors(mapped.fieldErrors);
      setFormError(mapped.formError);
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex w-fit items-center gap-2 rounded-field bg-primary-container px-5 py-3 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <Plus aria-hidden="true" className="size-4" />
        Record waste
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="Record waste" className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5 sm:p-6">
      <h2 className="font-display text-headline-md text-on-surface">Record waste</h2>
      <FormAlert>{formError}</FormAlert>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          id="waste-location"
          label="Where"
          value={form.locationId}
          onChange={update("locationId")}
          options={[{ value: "", label: "Choose a location" }, ...locations.map((location) => ({ value: location.id, label: multiBranch ? `${location.name} — ${location.branch.name}` : location.name }))]}
          error={errors.locationId}
        />
        <ItemSelect id="waste-item" label="What" value={form.itemId} onChange={update("itemId")} items={items} error={errors.itemId} />
        <Field
          id="waste-quantity"
          label={`How much${item ? ` (${item.uom.code})` : ""}`}
          inputMode="decimal"
          value={form.quantity}
          onChange={update("quantity")}
          error={errors.quantity}
          hint={onHand != null && item ? `${formatQuantity(onHand, { precision: item.uom.precision, unit: item.uom.code })} on the books here.` : null}
        />
        <SelectField
          id="waste-reason"
          label="Why"
          value={form.reason}
          onChange={update("reason")}
          options={[{ value: "", label: "Choose a reason" }, ...RECORDABLE_WASTAGE_REASONS]}
          error={errors.reason}
          hint={reason?.hint}
        />
      </div>
      <TextAreaField id="waste-notes" label="Note" rows={2} placeholder={form.reason === "OTHER" ? "Say what happened" : "Optional"} value={form.notes} onChange={update("notes")} error={errors.notes} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {pending ? "Recording…" : "Record it"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-field px-5 py-2.5 text-label-bold text-on-surface-variant hover:text-on-surface">Close</button>
      </div>
    </form>
  );
}
