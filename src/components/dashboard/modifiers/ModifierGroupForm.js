"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Plus, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { toFormErrors } from "@/lib/form-errors";
import { MODIFIER_GROUP_FIELDS, describeModifierRule, modifierGroupFormValues, modifierGroupPayload } from "@/lib/modifier-rules";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";

/**
 * A modifier group's name and pick rules — and, on create, its first choices.
 *
 * On edit the choices live in their own editor: each one has order history,
 * and folding them into this form would turn "rename the group" into a save
 * that also re-sends every price.
 *
 * The live rule preview under the controls is written the way checkout
 * enforces the rule, which is less obvious than the numbers suggest.
 */
export default function ModifierGroupForm({ group = null, optionCount = 0, currency, readOnly = false }) {
  const router = useRouter();
  const creating = !group;
  const [form, setForm] = useState(() => modifierGroupFormValues(group));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const update = (key) => (event) => set(key, event.target.value);
  const single = form.selectionType === "SINGLE";

  const preview = describeModifierRule({
    selectionType: form.selectionType,
    minSelect: Number(form.minSelect) || 0,
    maxSelect: single ? 1 : Number(form.maxSelect) || 1,
    allowQuantity: !single && form.allowQuantity,
  });

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending || readOnly) return;
    const { body, errors: local } = modifierGroupPayload(form, { creating, optionCount });
    if (Object.keys(local).length) {
      setErrors(local);
      setFormError("Some fields need attention.");
      return;
    }
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      if (creating) {
        const created = await api.post("/admin/modifier-groups", body);
        toast.success(`${created.name} created.`);
        router.push(`/dashboard/modifiers/${created.id}`);
      } else {
        await api.patch(`/admin/modifier-groups/${group.id}`, body);
        toast.success("Group saved.");
        setPending(false);
      }
      router.refresh();
    } catch (failure) {
      const mapped = toFormErrors(failure, { fields: MODIFIER_GROUP_FIELDS, conflictField: "internalName" });
      setErrors(mapped.fieldErrors);
      setFormError(mapped.formError);
      setPending(false);
    }
  }

  const rows = form.options;
  const setRow = (key, patch) => set("options", rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <FormAlert>{formError}</FormAlert>

      <fieldset disabled={readOnly} className="flex flex-col gap-6">
        <Section title="The group" description="What customers see as the heading above the choices.">
          <Field id="group-name" label="Name customers see" required autoFocus={creating} placeholder="e.g. Choose a sauce" value={form.name} onChange={update("name")} error={errors.name} />
          <Field
            id="group-internal"
            label="Internal name"
            placeholder="e.g. Burger sauces"
            value={form.internalName}
            onChange={update("internalName")}
            error={errors.internalName}
            hint="Optional. Tells apart two groups with the same public name — two different “Choose a sauce” groups, say."
          />
        </Section>

        <Section title="How many can be picked">
          <fieldset>
            <legend className="mb-2 text-label-bold text-on-surface">Type</legend>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "SINGLE", label: "One choice", hint: "e.g. crust, doneness" },
                { value: "MULTIPLE", label: "Several choices", hint: "e.g. extra toppings" },
              ].map((choice) => (
                <label
                  key={choice.value}
                  className={`flex cursor-pointer items-center gap-2 rounded-field px-4 py-2.5 text-label-bold ${
                    form.selectionType === choice.value ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-low text-on-surface"
                  }`}
                >
                  <input type="radio" name="selection-type" value={choice.value} checked={form.selectionType === choice.value} onChange={() => set("selectionType", choice.value)} className="accent-primary" />
                  {choice.label}
                  <span className="font-normal opacity-80">{choice.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              id="group-min"
              label="Minimum, if they pick any"
              inputMode="numeric"
              value={form.minSelect}
              onChange={update("minSelect")}
              error={errors.minSelect}
              hint={single ? "0 or 1." : null}
            />
            {single ? null : (
              <Field id="group-max" label="Maximum" inputMode="numeric" value={form.maxSelect} onChange={update("maxSelect")} error={errors.maxSelect} />
            )}
          </div>

          {single ? null : (
            <label className="flex cursor-pointer items-start gap-3 rounded-field bg-surface-container-low p-4">
              <input type="checkbox" checked={form.allowQuantity} onChange={(event) => set("allowQuantity", event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-primary" />
              <span>
                <span className="block text-label-bold text-on-surface">Allow the same choice more than once</span>
                <span className="block text-body-md text-on-surface-variant">For “double cheese”. Each repeat counts towards the maximum.</span>
              </span>
            </label>
          )}

          <p className="rounded-field bg-surface-container-low px-4 py-3 text-body-md text-on-surface" aria-live="polite">
            <span className="text-label-bold">Customers see: </span>
            {preview}.{" "}
            <span className="text-on-surface-variant">
              A customer can still skip this group unless a product marks it Required.
            </span>
          </p>

          <label className="flex cursor-pointer items-start gap-3 rounded-field bg-surface-container-low p-4">
            <input type="checkbox" checked={form.isActive} onChange={(event) => set("isActive", event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-primary" />
            <span>
              <span className="block text-label-bold text-on-surface">Switched on</span>
              <span className="block text-body-md text-on-surface-variant">
                Switching it off hides it from every product that uses it, without removing it from them.
              </span>
            </span>
          </label>
        </Section>

        {creating ? (
          <Section title="Choices" description={`Price adjustments in ${currency}. Leave blank for no charge; use a minus for a discount.`}>
            {rows.map((row, index) => (
              <div key={row.key} className="flex flex-wrap items-end gap-3 rounded-field bg-surface-container-low p-3">
                <div className="min-w-40 flex-[2]">
                  <Field id={`option-name-${row.key}`} label={`Choice ${index + 1}`} placeholder="e.g. Garlic mayo" value={row.name} onChange={(event) => setRow(row.key, { name: event.target.value })} />
                </div>
                <div className="min-w-28 flex-1">
                  <Field id={`option-delta-${row.key}`} label={`Adds (${currency})`} inputMode="decimal" placeholder="0" value={row.priceDelta} onChange={(event) => setRow(row.key, { priceDelta: event.target.value })} />
                </div>
                <label className="flex items-center gap-2 pb-3 text-body-md text-on-surface">
                  <input
                    type="checkbox"
                    checked={row.isDefault}
                    onChange={(event) =>
                      set(
                        "options",
                        rows.map((other) =>
                          other.key === row.key
                            ? { ...other, isDefault: event.target.checked }
                            : single && event.target.checked
                              ? { ...other, isDefault: false }
                              : other,
                        ),
                      )
                    }
                    className="size-4 accent-primary"
                  />
                  Pre-selected
                </label>
                {rows.length > 1 ? (
                  <button
                    type="button"
                    aria-label={`Remove choice ${index + 1}`}
                    onClick={() => set("options", rows.filter((other) => other.key !== row.key))}
                    className="mb-1.5 inline-flex size-10 items-center justify-center rounded-field text-on-surface-variant hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <X aria-hidden="true" className="size-4" />
                  </button>
                ) : null}
              </div>
            ))}
            <button
              type="button"
              onClick={() => set("options", [...rows, { key: `o${Date.now()}`, name: "", priceDelta: "", isDefault: false }])}
              className="inline-flex w-fit items-center gap-2 rounded-field px-3 py-2 text-label-bold text-primary hover:underline"
            >
              <Plus aria-hidden="true" className="size-4" />
              Add a choice
            </button>
            {errors.options ? (
              <p role="alert" className="text-label-bold text-error">
                {errors.options}
              </p>
            ) : null}
          </Section>
        ) : null}
      </fieldset>

      {readOnly ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-48 flex-1">
            <SubmitButton pending={pending} pendingLabel={creating ? "Creating…" : "Saving…"}>
              {creating ? "Create group" : "Save group"}
            </SubmitButton>
          </div>
          {creating ? (
            <Link href="/dashboard/modifiers" className="rounded-field px-5 py-3.5 text-label-bold text-on-surface-variant hover:text-on-surface">
              Cancel
            </Link>
          ) : null}
        </div>
      )}
    </form>
  );
}
