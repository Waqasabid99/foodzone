"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Plus, Star } from "lucide-react";
import { api } from "@/lib/api-client";
import { toFormErrors } from "@/lib/form-errors";
import { formatMoney } from "@/lib/format";
import { variantFormValues, variantPayload } from "@/lib/product-form";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";

const VARIANT_FIELDS = ["name", "price", "compareAtPrice", "sku", "servingSize"];

/**
 * A product's sizes, each saved on its own.
 *
 * Each size is a separate record with its own SKU and order history, so each
 * row saves independently: changing the large's price must not re-send the
 * regular's. The server keeps the invariants — one default, at least one
 * active size, no deleting a size that has been sold — and its refusals are
 * shown as written, because they already say what to do instead.
 */
export default function VariantEditor({ productId, variants, currency, can, title = "Sizes and prices" }) {
  const router = useRouter();
  const [editing, setEditing] = useState(null); // variant id, "new", or null
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);

  async function run(id, action, success) {
    setBusy(id);
    setMessage(null);
    try {
      await action();
      if (success) toast.success(success);
      router.refresh();
    } catch (failure) {
      setMessage(failure?.message ?? "That change could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  const activeCount = variants.filter((variant) => variant.isActive).length;

  return (
    <Section
      title={title}
      description={`Prices in ${currency}. A branch menu can still override a price for one outlet.`}
    >
      <FormAlert>{message}</FormAlert>

      <ul className="flex flex-col gap-3">
        {variants.map((variant) =>
          editing === variant.id ? (
            <li key={variant.id}>
              <VariantForm
                productId={productId}
                variant={variant}
                currency={currency}
                onDone={() => setEditing(null)}
              />
            </li>
          ) : (
            <li
              key={variant.id}
              className={`flex flex-wrap items-center gap-3 rounded-field bg-surface-container-low p-4 ${variant.isActive ? "" : "opacity-75"}`}
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-label-bold text-on-surface">
                  {variant.name}
                  {variant.isDefault ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-secondary-container px-2 py-0.5 text-on-secondary-container">
                      <Star aria-hidden="true" className="size-3" />
                      Default
                    </span>
                  ) : null}
                  {!variant.isActive ? (
                    <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-on-surface-variant">
                      Not sold
                    </span>
                  ) : null}
                </p>
                <p className="text-body-md text-on-surface-variant">
                  <span className="tabular-nums text-on-surface">{formatMoney(variant.price, currency)}</span>
                  {variant.compareAtPrice ? (
                    <>
                      {" "}
                      <s className="tabular-nums">{formatMoney(variant.compareAtPrice, currency)}</s>
                    </>
                  ) : null}
                  {" · "}
                  <span className="font-mono">{variant.sku}</span>
                  {variant.servingSize ? ` · ${variant.servingSize}` : ""}
                </p>
              </div>

              <div className="flex flex-wrap gap-1">
                {can.update ? (
                  <RowButton disabled={busy !== null} onClick={() => setEditing(variant.id)}>
                    Edit
                  </RowButton>
                ) : null}
                {can.update && variant.isActive && !variant.isDefault ? (
                  <RowButton
                    disabled={busy !== null}
                    onClick={() =>
                      run(
                        variant.id,
                        () => api.patch(`/admin/products/${productId}/variants/${variant.id}`, { isDefault: true }),
                        `${variant.name} is now the default.`,
                      )
                    }
                  >
                    Make default
                  </RowButton>
                ) : null}
                {can.update ? (
                  <RowButton
                    disabled={busy !== null || (variant.isActive && activeCount === 1)}
                    title={variant.isActive && activeCount === 1 ? "A product must keep at least one size on sale" : undefined}
                    onClick={() =>
                      run(
                        variant.id,
                        () =>
                          api.patch(`/admin/products/${productId}/variants/${variant.id}`, {
                            isActive: !variant.isActive,
                          }),
                        variant.isActive ? `${variant.name} is no longer sold.` : `${variant.name} is on sale again.`,
                      )
                    }
                  >
                    {variant.isActive ? "Stop selling" : "Sell again"}
                  </RowButton>
                ) : null}
                {can.delete && variants.length > 1 ? (
                  <RowButton
                    tone="danger"
                    disabled={busy !== null}
                    onClick={() => {
                      if (!window.confirm(`Delete the "${variant.name}" size? This cannot be undone.`)) return;
                      run(
                        variant.id,
                        () => api.delete(`/admin/products/${productId}/variants/${variant.id}`),
                        `${variant.name} deleted.`,
                      );
                    }}
                  >
                    Delete
                  </RowButton>
                ) : null}
              </div>
            </li>
          ),
        )}
      </ul>

      {can.create ? (
        editing === "new" ? (
          <VariantForm productId={productId} currency={currency} onDone={() => setEditing(null)} />
        ) : (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="inline-flex w-fit items-center gap-2 rounded-field px-3 py-2 text-label-bold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Plus aria-hidden="true" className="size-4" />
            Add a size
          </button>
        )
      ) : null}
    </Section>
  );
}

function RowButton({ tone = "neutral", children, ...props }) {
  return (
    <button
      type="button"
      className={`rounded-field px-3 py-2 text-label-bold hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40 ${
        tone === "danger" ? "text-error" : "text-on-surface"
      }`}
      {...props}
    >
      {children}
    </button>
  );
}

function VariantForm({ productId, variant = null, currency, onDone }) {
  const router = useRouter();
  const creating = !variant;
  const [form, setForm] = useState(() => variantFormValues(variant));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const prefix = variant?.id ?? "new";

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const { body, errors: local } = variantPayload(form, { creating });
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }

    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      if (creating) await api.post(`/admin/products/${productId}/variants`, body);
      else await api.patch(`/admin/products/${productId}/variants/${variant.id}`, body);
      toast.success(creating ? `${body.name} added.` : `${body.name} saved.`);
      onDone();
      router.refresh();
    } catch (failure) {
      const mapped = toFormErrors(failure, {
        fields: VARIANT_FIELDS,
        // Two clashes are possible — a duplicate size name, or a SKU already
        // used anywhere in the catalogue — and the message says which.
        conflictField: /sku/i.test(failure?.message ?? "") ? "sku" : "name",
      });
      setErrors(mapped.fieldErrors);
      setFormError(mapped.formError);
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label={creating ? "New size" : `Edit ${variant.name}`}
      className="flex flex-col gap-4 rounded-field border border-outline-variant p-4"
    >
      <FormAlert>{formError}</FormAlert>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`variant-name-${prefix}`} label="Size name" placeholder="e.g. Large" autoFocus value={form.name} onChange={update("name")} error={errors.name} />
        <Field id={`variant-price-${prefix}`} label={`Price (${currency})`} inputMode="decimal" value={form.price} onChange={update("price")} error={errors.price} />
        <Field
          id={`variant-compare-${prefix}`}
          label={`Was price (${currency})`}
          inputMode="decimal"
          value={form.compareAtPrice}
          onChange={update("compareAtPrice")}
          error={errors.compareAtPrice}
          hint="Optional. Shows the price crossed out beside the real one."
        />
        <Field id={`variant-serving-${prefix}`} label="Serving size" placeholder="e.g. 250 g, serves 2" value={form.servingSize} onChange={update("servingSize")} error={errors.servingSize} />
        <Field
          id={`variant-sku-${prefix}`}
          label="SKU"
          placeholder={creating ? "Generated if left blank" : undefined}
          value={form.sku}
          onChange={update("sku")}
          error={errors.sku}
          hint={creating ? null : "Printed on labels and purchase orders. Must be unique."}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {pending ? "Saving…" : creating ? "Add size" : "Save size"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-field px-5 py-2.5 text-label-bold text-on-surface-variant hover:text-on-surface"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
