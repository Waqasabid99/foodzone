"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { toFormErrors } from "@/lib/form-errors";
import { MENU_TYPES } from "@/lib/menu-schedule";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";
import SelectField from "@/components/ui/SelectField";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";

/**
 * Copies this menu to another branch or channel — how a second branch, or a
 * delivery menu priced above dine-in, gets set up without re-entering it.
 *
 * The copy is always created switched off, so its prices can be adjusted
 * before anyone orders from it, and sold-out marks are not carried over.
 */
export default function CloneMenuForm({ menu, branches }) {
  const router = useRouter();
  const [form, setForm] = useState({ branchId: branches.some((branch) => branch.id === menu.branchId) ? menu.branchId : (branches[0]?.id ?? ""), type: menu.type, name: "", includeItems: true });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const sameSlot = form.branchId === menu.branchId && form.type === menu.type;
  const defaultName = sameSlot ? `${menu.name} (copy)` : menu.name;

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const name = form.name.trim();
    if (name.length > 120) return setErrors({ name: "Keep it under 120 characters." });
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      const copy = await api.post(`/admin/menus/${menu.id}/clone`, {
        branchId: form.branchId,
        type: form.type,
        ...(name ? { name } : {}),
        includeItems: form.includeItems,
      });
      toast.success(`${copy.name} created, switched off.`);
      router.push(`/dashboard/menus/${copy.id}`);
      router.refresh();
    } catch (failure) {
      const mapped = toFormErrors(failure, { fields: ["branchId", "type", "name"] });
      setErrors(mapped.fieldErrors);
      setFormError(mapped.formError);
      setPending(false);
    }
  }

  return (
    <Section title="Copy this menu" description="Make a copy for another branch or channel, then adjust its prices. The copy starts switched off, and sold-out marks are not copied.">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <FormAlert>{formError}</FormAlert>
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField id="clone-branch" label="To branch" value={form.branchId} onChange={(event) => set("branchId", event.target.value)} error={errors.branchId} options={branches.map((branch) => ({ value: branch.id, label: branch.name }))} />
          <SelectField id="clone-type" label="Used for" value={form.type} onChange={(event) => set("type", event.target.value)} error={errors.type} options={MENU_TYPES.map((entry) => ({ value: entry.value, label: entry.label }))} />
        </div>
        <Field id="clone-name" label="Name" placeholder={defaultName} value={form.name} onChange={(event) => set("name", event.target.value)} error={errors.name} hint={`Leave empty for “${defaultName}”.`} />
        <label className="flex cursor-pointer items-start gap-3 rounded-field bg-surface-container-low p-4">
          <input type="checkbox" checked={form.includeItems} onChange={(event) => set("includeItems", event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-primary" />
          <span>
            <span className="block text-label-bold text-on-surface">Copy the products and their menu prices</span>
            <span className="block text-body-md text-on-surface-variant">Untick to copy only the name, schedule and sections.</span>
          </span>
        </label>
        <button type="submit" disabled={pending} className="w-fit rounded-field bg-secondary-container px-5 py-3 text-label-bold text-on-secondary-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {pending ? "Copying…" : "Make a copy"}
        </button>
      </form>
    </Section>
  );
}
