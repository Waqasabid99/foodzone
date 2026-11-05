"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { toFormErrors } from "@/lib/form-errors";
import { ITEM_FIELDS, ITEM_TYPES, UNIT_TYPES, itemFormValues, itemPayload } from "@/lib/inventory";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";

/**
 * An item's own fields.
 *
 * The unit is locked once stock has moved: every past quantity was recorded in
 * it, and "5" meaning kilograms yesterday and grams today is the quietest way
 * to wreck a store room's numbers.
 */
export default function ItemForm({ item = null, categories, units, unitLocked = false, readOnly = false }) {
  const router = useRouter();
  const editing = Boolean(item);
  const [form, setForm] = useState(() => itemFormValues(item));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const update = (key) => (event) => set(key, event.target.value);
  const toggle = (key) => (event) => set(key, event.target.checked);
  const unit = units.find((option) => option.id === form.uomId);
  const kind = ITEM_TYPES.find((option) => option.value === form.type);

  const unitOptions = [
    { value: "", label: "Choose a unit" },
    ...UNIT_TYPES.flatMap((type) =>
      units.filter((option) => option.type === type.value).map((option) => ({ value: option.id, label: `${option.name} (${option.code}) — ${type.label.toLowerCase()}` })),
    ),
  ];
  // An item may sit on a unit that has since been switched off; it still has to show.
  if (item?.uom && !units.some((option) => option.id === item.uomId)) {
    unitOptions.push({ value: item.uomId, label: `${item.uom.name} (${item.uom.code}) — switched off` });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending || readOnly) return;
    const { body, errors: local } = itemPayload(form, { original: item });
    if (Object.keys(local).length) {
      setErrors(local);
      setFormError(local.form ?? "Some fields need attention.");
      return;
    }
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      if (editing) {
        await api.patch(`/admin/inventory-items/${item.id}`, body);
        toast.success(`${body.name ?? item.name} saved.`);
        router.refresh();
      } else {
        const created = await api.post("/admin/inventory-items", body);
        toast.success(`${created.name} added.`);
        router.push(`/dashboard/inventory-items/${created.id}`);
        router.refresh();
      }
    } catch (failure) {
      const mapped = toFormErrors(failure, { fields: ITEM_FIELDS, conflictField: "sku" });
      setErrors(mapped.fieldErrors);
      setFormError(mapped.formError);
    } finally {
      setPending(false);
    }
  }

  const checkbox = (key, label, hint) => (
    <label htmlFor={`item-${key}`} className="flex items-start gap-3 rounded-field bg-surface-container-low p-3">
      <input id={`item-${key}`} type="checkbox" checked={form[key]} onChange={toggle(key)} className="mt-1 size-4 accent-primary" />
      <span>
        <span className="block text-label-bold text-on-surface">{label}</span>
        <span className="block text-body-md text-on-surface-variant">{hint}</span>
      </span>
    </label>
  );

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <FormAlert>{formError}</FormAlert>

      <fieldset disabled={readOnly} className="flex flex-col gap-6">
        <Section title="What it is" description={readOnly ? "You can view these but not change them." : null}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="item-name" label="Name" required placeholder="e.g. Chicken breast" value={form.name} onChange={update("name")} error={errors.name} />
            <Field id="item-sku" label="SKU" placeholder={editing ? "" : "Leave blank to make one"} value={form.sku} onChange={update("sku")} error={errors.sku} hint="Your code for it, printed on count sheets." />
            <SelectField id="item-type" label="Kind" value={form.type} onChange={update("type")} options={ITEM_TYPES} error={errors.type} hint={kind?.hint} />
            <SelectField
              id="item-category"
              label="Category"
              value={form.categoryId}
              onChange={update("categoryId")}
              options={[{ value: "", label: "None" }, ...categories.map((option) => ({ value: option.id, label: option.isActive ? option.name : `${option.name} (switched off)` }))]}
              error={errors.categoryId}
            />
            <SelectField
              id="item-unit"
              label="Counted in"
              value={form.uomId}
              onChange={update("uomId")}
              options={unitOptions}
              error={errors.uomId}
              disabled={unitLocked}
              hint={unitLocked ? "Locked: stock has already been recorded in this unit." : "Deliveries and recipes may use other units of the same kind; they are converted."}
            />
            <Field id="item-barcode" label="Barcode" placeholder="Optional" value={form.barcode} onChange={update("barcode")} error={errors.barcode} />
          </div>
          <TextAreaField id="item-description" label="Notes" rows={2} placeholder="Optional — brand, storage, anything a new store keeper should know" value={form.description} onChange={update("description")} error={errors.description} />
        </Section>

        <Section title="Reordering" description="When it shows as low, and how much to buy when it does. Checked at each location on its own.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="item-reorder-level" label={`Low at${unit ? ` (${unit.code})` : ""}`} inputMode="decimal" placeholder="Optional" value={form.reorderLevel} onChange={update("reorderLevel")} error={errors.reorderLevel} hint="Flagged at or below this." />
            <Field id="item-reorder-quantity" label={`Order${unit ? ` (${unit.code})` : ""}`} inputMode="decimal" placeholder="Optional" value={form.reorderQuantity} onChange={update("reorderQuantity")} error={errors.reorderQuantity} hint="Added on top of the low level when suggesting an order." />
            <Field id="item-yield" label="Usable after prep (%)" inputMode="decimal" value={form.yieldPercent} onChange={update("yieldPercent")} error={errors.yieldPercent} hint="80 means 1 kg bought gives 800 g to cook with." />
          </div>
        </Section>

        <Section title="Shelf life">
          <div className="grid gap-3 sm:grid-cols-2">
            {checkbox("isPerishable", "Goes off", "Meat, dairy, fresh produce — anything with a use-by date.")}
            {checkbox("trackBatches", "Track each delivery separately", "Keeps each delivery's own date and cost, and uses the oldest first.")}
          </div>
          <div className="max-w-xs">
            <Field id="item-shelf-life" label="Shelf life (days)" inputMode="numeric" placeholder={form.isPerishable ? "e.g. 3" : "Optional"} value={form.shelfLifeDays} onChange={update("shelfLifeDays")} error={errors.shelfLifeDays} hint="From the day it arrives." />
          </div>
        </Section>

        <Section title="Costing" description="How the cost of what is used is worked out. Most kitchens use the average.">
          <div className="max-w-md">
            <SelectField
              id="item-costing"
              label="Method"
              value={form.costingMethod}
              onChange={update("costingMethod")}
              options={[
                { value: "WEIGHTED_AVERAGE", label: "Average cost" },
                { value: "FIFO", label: "Oldest delivery first (FIFO)" },
              ]}
              error={errors.costingMethod}
              hint={form.costingMethod === "FIFO" ? "Only has an effect with delivery tracking on; otherwise the average is used." : "Each delivery is blended into one running cost."}
            />
          </div>
        </Section>
      </fieldset>

      {readOnly ? null : (
        <div className="min-w-48 max-w-xs">
          <SubmitButton pending={pending} pendingLabel="Saving…">{editing ? "Save item" : "Add item"}</SubmitButton>
        </div>
      )}
    </form>
  );
}
