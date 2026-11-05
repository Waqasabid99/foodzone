"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { ArrowDown, ArrowUp, CircleAlert, Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import { toFormErrors } from "@/lib/form-errors";
import { formatMoney } from "@/lib/format";
import { comboGroupPayload, comboOptionAvailable, comboOptionPayload, describeSlotRule } from "@/lib/combo-rules";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";

function signed(amount, currency) {
  const value = Number(amount);
  if (!value) return "Included";
  return `${value > 0 ? "+" : "−"}${formatMoney(Math.abs(value), currency)}`;
}

/**
 * A combo's slots — "Choose a burger", "Choose a drink" — and the choices in each.
 *
 * The price a customer pays is the combo's own price plus the adjustment of
 * each choice they make, so every choice shows its adjustment, and a choice
 * that is no longer on sale is flagged where it sits rather than discovered at
 * checkout.
 */
export default function ComboSlotsEditor({ comboId, groups, catalog, basePrice, currency, can }) {
  const router = useRouter();
  const [editing, setEditing] = useState(null); // `slot:<id>`, `slot:new`, `add:<groupId>`, `option:<id>`
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const base = `/admin/products/${comboId}/combo-groups`;

  async function run(action, success) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (success) toast.success(success);
      router.refresh();
    } catch (failure) {
      setMessage(failure?.message ?? "That change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const moveSlot = (index, by) =>
    run(async () => {
      const next = [...groups];
      [next[index], next[index + by]] = [next[index + by], next[index]];
      for (const [position, group] of next.entries()) {
        if (group.sortOrder !== position) await api.patch(`${base}/${group.id}`, { sortOrder: position });
      }
    });

  return (
    <Section
      title="Slots"
      description={`What the customer chooses. The price is ${basePrice === null ? "the combo's price" : formatMoney(basePrice, currency)} plus the adjustment on each choice they pick.`}
    >
      <FormAlert>{message}</FormAlert>

      {groups.length ? (
        <ol className="flex flex-col gap-4">
          {groups.map((group, index) => (
            <li key={group.id} className="flex flex-col gap-3 rounded-card border border-outline-variant p-4">
              {editing === `slot:${group.id}` ? (
                <SlotForm endpoint={`${base}/${group.id}`} group={group} onDone={() => setEditing(null)} />
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  {can.update && groups.length > 1 ? (
                    <div className="flex">
                      <IconButton label={`Move ${group.name} earlier`} icon={ArrowUp} disabled={busy || index === 0} onClick={() => moveSlot(index, -1)} />
                      <IconButton label={`Move ${group.name} later`} icon={ArrowDown} disabled={busy || index === groups.length - 1} onClick={() => moveSlot(index, 1)} />
                    </div>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <h3 className="text-label-bold text-on-surface">{group.name}</h3>
                    <p className="text-body-md text-on-surface-variant">{describeSlotRule(group)}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {can.update ? <RowButton disabled={busy} onClick={() => setEditing(`slot:${group.id}`)}>Edit slot</RowButton> : null}
                    {can.delete ? (
                      <RowButton
                        tone="danger"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(`Delete the "${group.name}" slot and its choices?`)) return;
                          run(() => api.delete(`${base}/${group.id}`), `${group.name} deleted.`);
                        }}
                      >
                        Delete slot
                      </RowButton>
                    ) : null}
                  </div>
                </div>
              )}

              {group.options.length ? (
                <ul className="flex flex-col gap-2">
                  {group.options.map((option) => {
                    const available = comboOptionAvailable(option);
                    const label = `${option.product.name}${option.variant ? ` — ${option.variant.name}` : ""}`;
                    return editing === `option:${option.id}` ? (
                      <li key={option.id}>
                        <OptionForm
                          endpoint={`${base}/${group.id}/options/${option.id}`}
                          option={option}
                          catalog={catalog}
                          currency={currency}
                          onDone={() => setEditing(null)}
                        />
                      </li>
                    ) : (
                      <li key={option.id} className={`flex flex-wrap items-center gap-3 rounded-field bg-surface-container-low p-3 ${available ? "" : "opacity-90"}`}>
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2 text-label-bold text-on-surface">
                            {label}
                            {option.isDefault ? <span className="rounded-full bg-secondary-container px-2 py-0.5 text-on-secondary-container">Pre-selected</span> : null}
                          </p>
                          <p className="text-body-md tabular-nums text-on-surface-variant">{signed(option.priceDelta, currency)}</p>
                          {available ? null : (
                            <p className="mt-0.5 flex items-center gap-1 text-label-bold text-error">
                              <CircleAlert aria-hidden="true" className="size-3.5" />
                              Not on sale — {option.product.deletedAt ? "deleted" : !option.product.isActive ? "product unpublished" : "this size is switched off"}
                            </p>
                          )}
                        </div>
                        {can.update ? (
                          <div className="flex flex-wrap gap-1">
                            <RowButton disabled={busy} onClick={() => setEditing(`option:${option.id}`)}>Edit</RowButton>
                            <RowButton
                              disabled={busy}
                              onClick={() => run(() => api.patch(`${base}/${group.id}/options/${option.id}`, { isDefault: !option.isDefault }), option.isDefault ? "No longer pre-selected." : "Pre-selected.")}
                            >
                              {option.isDefault ? "Unselect" : "Pre-select"}
                            </RowButton>
                            <RowButton
                              tone="danger"
                              disabled={busy}
                              onClick={() => run(() => api.delete(`${base}/${group.id}/options/${option.id}`), `${option.product.name} removed.`)}
                            >
                              Remove
                            </RowButton>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-body-md text-on-surface-variant">No choices in this slot yet.</p>
              )}

              {can.update ? (
                editing === `add:${group.id}` ? (
                  <OptionForm endpoint={`${base}/${group.id}/options`} catalog={catalog} currency={currency} taken={group.options} onDone={() => setEditing(null)} />
                ) : (
                  <button type="button" onClick={() => setEditing(`add:${group.id}`)} className="inline-flex w-fit items-center gap-2 rounded-field px-3 py-2 text-label-bold text-primary hover:underline">
                    <Plus aria-hidden="true" className="size-4" />
                    Add a choice
                  </button>
                )
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-body-md text-on-surface-variant">No slots yet. Start with the part of the meal customers choose first.</p>
      )}

      {can.create ? (
        editing === "slot:new" ? (
          <SlotForm endpoint={base} onDone={() => setEditing(null)} />
        ) : (
          <button type="button" onClick={() => setEditing("slot:new")} className="inline-flex w-fit items-center gap-2 rounded-field bg-surface-container-high px-4 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest">
            <Plus aria-hidden="true" className="size-4" />
            Add a slot
          </button>
        )
      ) : null}
    </Section>
  );
}

function SlotForm({ endpoint, group = null, onDone }) {
  const router = useRouter();
  const creating = !group;
  const [form, setForm] = useState({ name: group?.name ?? "", minSelect: String(group?.minSelect ?? 1), maxSelect: String(group?.maxSelect ?? 1) });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const prefix = group?.id ?? "new";
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const { body, errors: local } = comboGroupPayload(form);
    if (Object.keys(local).length) return setErrors(local);
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      if (creating) await api.post(endpoint, body);
      else await api.patch(endpoint, body);
      toast.success(creating ? `${body.name} added.` : "Slot saved.");
      onDone();
      router.refresh();
    } catch (failure) {
      const mapped = toFormErrors(failure, { fields: ["name", "minSelect", "maxSelect"] });
      setErrors(mapped.fieldErrors);
      setFormError(mapped.formError);
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label={creating ? "New slot" : `Edit ${group.name}`} className="flex flex-col gap-4 rounded-field bg-surface-container-low p-4">
      <FormAlert>{formError}</FormAlert>
      <Field id={`slot-name-${prefix}`} label="Slot name" autoFocus placeholder="e.g. Choose a drink" value={form.name} onChange={update("name")} error={errors.name} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`slot-min-${prefix}`} label="Customer must pick at least" inputMode="numeric" value={form.minSelect} onChange={update("minSelect")} error={errors.minSelect} hint="0 makes the slot optional." />
        <Field id={`slot-max-${prefix}`} label="And at most" inputMode="numeric" value={form.maxSelect} onChange={update("maxSelect")} error={errors.maxSelect} />
      </div>
      <FormButtons pending={pending} label={creating ? "Add slot" : "Save slot"} onCancel={onDone} />
    </form>
  );
}

function OptionForm({ endpoint, option = null, catalog, currency, taken = [], onDone }) {
  const router = useRouter();
  const creating = !option;
  const [form, setForm] = useState({
    productId: option?.productId ?? "",
    variantId: option?.variantId ?? "",
    priceDelta: option && Number(option.priceDelta) ? String(option.priceDelta) : "",
    isDefault: Boolean(option?.isDefault),
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const prefix = option?.id ?? "new";

  const product = useMemo(() => catalog.find((row) => row.id === form.productId) ?? null, [catalog, form.productId]);
  const takenKeys = new Set(taken.map((row) => `${row.productId}:${row.variantId}`));

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const { body, errors: local } = comboOptionPayload(form);
    if (Object.keys(local).length) return setErrors(local);
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      if (creating) {
        await api.post(endpoint, body);
      } else {
        // The product of an existing choice cannot be swapped — remove it and
        // add another — so only the size, adjustment and default are sent.
        const { productId: _product, ...rest } = body;
        await api.patch(endpoint, rest);
      }
      toast.success(creating ? "Choice added." : "Choice saved.");
      onDone();
      router.refresh();
    } catch (failure) {
      const mapped = toFormErrors(failure, { fields: ["productId", "variantId", "priceDelta"] });
      setErrors(mapped.fieldErrors);
      setFormError(mapped.formError);
      setPending(false);
    }
  }

  const productOptions = [
    { value: "", label: "Choose a product" },
    ...catalog.map((row) => ({
      value: row.id,
      label: `${row.name}${row.category ? ` (${row.category})` : ""}${row.isActive ? "" : " — draft"}`,
    })),
  ];

  const sizeOptions = product
    ? [
        { value: "", label: `Default size${product.variants.find((variant) => variant.isDefault) ? ` — ${product.variants.find((variant) => variant.isDefault).name}` : ""}` },
        ...product.variants.map((variant) => ({
          value: variant.id,
          label: `${variant.name} — ${formatMoney(variant.price, currency)}${variant.isActive ? "" : " (switched off)"}${takenKeys.has(`${product.id}:${variant.id}`) ? " (already a choice)" : ""}`,
          disabled: !variant.isActive,
        })),
      ]
    : [];

  return (
    <form onSubmit={handleSubmit} noValidate aria-label={creating ? "New choice" : `Edit ${option.product.name}`} className="flex flex-col gap-4 rounded-field bg-surface-container-low p-4">
      <FormAlert>{formError}</FormAlert>
      {creating ? (
        <SelectField
          id={`choice-product-${prefix}`}
          label="Product"
          value={form.productId}
          onChange={(event) => setForm((current) => ({ ...current, productId: event.target.value, variantId: "" }))}
          options={productOptions}
          error={errors.productId}
          hint={catalog.length ? "Combos cannot contain other combos, so they are not listed." : "There are no products to choose from yet."}
        />
      ) : (
        <p className="text-label-bold text-on-surface">{option.product.name}</p>
      )}
      {product || !creating ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {product ? (
            <SelectField
              id={`choice-size-${prefix}`}
              label="Size"
              value={form.variantId}
              onChange={(event) => setForm((current) => ({ ...current, variantId: event.target.value }))}
              options={creating ? sizeOptions : sizeOptions.filter((row) => row.value !== "")}
              error={errors.variantId}
            />
          ) : null}
          <Field
            id={`choice-delta-${prefix}`}
            label={`Adds to the combo price (${currency})`}
            inputMode="decimal"
            placeholder="0"
            value={form.priceDelta}
            onChange={(event) => setForm((current) => ({ ...current, priceDelta: event.target.value }))}
            error={errors.priceDelta}
            hint="0 when it is included. e.g. 100 to upgrade to a large drink."
          />
        </div>
      ) : null}
      {creating ? (
        <label className="flex items-center gap-2 text-body-md text-on-surface">
          <input type="checkbox" checked={form.isDefault} onChange={(event) => setForm((current) => ({ ...current, isDefault: event.target.checked }))} className="size-4 accent-primary" />
          Pre-selected
        </label>
      ) : null}
      <FormButtons pending={pending} label={creating ? "Add choice" : "Save choice"} onCancel={onDone} />
    </form>
  );
}

function FormButtons({ pending, label, onCancel }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button type="submit" disabled={pending} className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {pending ? "Saving…" : label}
      </button>
      <button type="button" onClick={onCancel} className="rounded-field px-5 py-2.5 text-label-bold text-on-surface-variant hover:text-on-surface">
        Cancel
      </button>
    </div>
  );
}

function RowButton({ tone = "neutral", children, ...props }) {
  return (
    <button
      type="button"
      className={`rounded-field px-3 py-2 text-label-bold hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40 ${tone === "danger" ? "text-error" : "text-on-surface"}`}
      {...props}
    >
      {children}
    </button>
  );
}

function IconButton({ label, icon: Icon, ...props }) {
  return (
    <button type="button" aria-label={label} title={label} className="inline-flex size-10 items-center justify-center rounded-field text-on-surface-variant hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-30" {...props}>
      <Icon aria-hidden="true" className="size-4" />
    </button>
  );
}
