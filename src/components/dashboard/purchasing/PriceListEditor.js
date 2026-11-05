"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Star, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { formatQuantity } from "@/lib/inventory";
import { supplierItemPayload } from "@/lib/purchasing";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";
import ItemSelect from "@/components/dashboard/inventory/ItemSelect";

const blank = { itemId: "", supplierSku: "", unitPrice: "", minOrderQuantity: "", leadTimeDays: "", isPreferred: false };

/**
 * What this supplier charges for what.
 *
 * This is the table that makes purchasing stop being guesswork: a purchase
 * order line opens on the agreed price, so a rise shows up as a change to
 * approve rather than as a number nobody questions. It is also why the same
 * item can sit on several suppliers' lists — the point is to be able to
 * compare them.
 *
 * **Preferred is one supplier per item**, and the server enforces it by
 * clearing the others. "Preferred" that applies to three suppliers means
 * nothing, so marking a new one silently unmarks the old, and the sentence
 * under the box says so before it happens.
 */
export default function PriceListEditor({ supplierId, currency, rows, items, canEdit }) {
  const router = useRouter();
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const [busyItem, setBusyItem] = useState(null);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const listed = new Set(rows.map((row) => row.item.id));
  const available = items.filter((item) => !listed.has(item.id) || item.id === form.itemId);

  async function save(payload, message) {
    setPending(true);
    setFormError(null);
    try {
      await api.put(`/admin/suppliers/${supplierId}/items`, payload);
      toast.success(message);
      setForm(blank);
      setErrors({});
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be saved.");
    } finally {
      setPending(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const { body, errors: local } = supplierItemPayload(form);
    setErrors(local);
    if (Object.keys(local).length) return setFormError("Some fields need attention.");
    await save(body, "Price saved.");
  }

  async function prefer(row) {
    if (busyItem) return;
    setBusyItem(row.item.id);
    setFormError(null);
    try {
      await api.put(`/admin/suppliers/${supplierId}/items`, {
        itemId: row.item.id,
        unitPrice: Number(row.unitPrice),
        ...(row.uom?.id ? { uomId: row.uom.id } : {}),
        supplierSku: row.supplierSku,
        minOrderQuantity: row.minOrderQuantity == null ? null : Number(row.minOrderQuantity),
        leadTimeDays: row.leadTimeDays,
        isPreferred: true,
      });
      toast.success(`${row.item.name} will be bought from here by default.`);
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "That did not work.");
    } finally {
      setBusyItem(null);
    }
  }

  async function remove(row) {
    if (busyItem) return;
    if (!window.confirm(`Take ${row.item.name} off this price list? Past orders keep the price they were placed at.`)) return;
    setBusyItem(row.item.id);
    setFormError(null);
    try {
      await api.delete(`/admin/suppliers/${supplierId}/items/${row.item.id}`);
      toast.success(`${row.item.name} removed.`);
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be removed.");
    } finally {
      setBusyItem(null);
    }
  }

  return (
    <section className="flex flex-col gap-5 rounded-card bg-surface-container-lowest p-5 sm:p-6">
      <div>
        <h2 className="font-display text-headline-md text-on-surface">Price list</h2>
        <p className="mt-1 text-body-md text-on-surface-variant">
          What they charge, and in which unit. An order raised against this supplier opens on these prices.
        </p>
      </div>

      <FormAlert>{formError}</FormAlert>

      {rows.length ? (
        <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
          <table className="w-full min-w-xl border-collapse text-body-md">
            <thead>
              <tr className="text-left text-label-bold text-on-surface-variant">
                <th scope="col" className="py-2 pr-3 font-normal">Item</th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">Price</th>
                <th scope="col" className="py-2 pr-3 font-normal">Their code</th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">Minimum</th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">Lead time</th>
                {canEdit ? <th scope="col" className="py-2"><span className="sr-only">Actions</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-outline-variant align-top">
                  <th scope="row" className="py-3 pr-3 text-left font-normal text-on-surface">
                    <span className="flex flex-wrap items-center gap-2">
                      {row.item.name}
                      {row.isPreferred ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-secondary-container px-2 py-0.5 text-label-bold text-on-secondary-container">
                          <Star aria-hidden="true" className="size-3" />
                          Preferred
                        </span>
                      ) : null}
                    </span>
                  </th>
                  <td className="py-3 pr-3 text-right tabular-nums text-on-surface">
                    {formatMoney(row.unitPrice, currency)}
                    <span className="block text-label-bold font-normal text-on-surface-variant">per {row.uom?.code ?? "unit"}</span>
                  </td>
                  <td className="py-3 pr-3 text-on-surface-variant">{row.supplierSku || "—"}</td>
                  <td className="py-3 pr-3 text-right tabular-nums text-on-surface-variant">
                    {row.minOrderQuantity ? formatQuantity(row.minOrderQuantity, { unit: row.uom?.code ?? null }) : "—"}
                  </td>
                  <td className="py-3 pr-3 text-right tabular-nums text-on-surface-variant">
                    {row.leadTimeDays == null ? "—" : `${row.leadTimeDays} ${row.leadTimeDays === 1 ? "day" : "days"}`}
                  </td>
                  {canEdit ? (
                    <td className="py-3">
                      <div className="flex justify-end gap-1">
                        {row.isPreferred ? null : (
                          <button
                            type="button"
                            onClick={() => prefer(row)}
                            disabled={busyItem === row.item.id}
                            className="rounded-field px-2 py-1.5 text-label-bold text-primary hover:bg-surface-container disabled:opacity-60"
                          >
                            Prefer
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`Remove ${row.item.name}`}
                          onClick={() => remove(row)}
                          disabled={busyItem === row.item.id}
                          className="rounded-field px-2 py-1.5 text-error hover:bg-surface-container disabled:opacity-60"
                        >
                          <Trash2 aria-hidden="true" className="size-4" />
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-field bg-surface-container-low px-4 py-3 text-body-md text-on-surface-variant">
          Nothing agreed yet. Until an item is on this list, every order from this supplier needs its price typed by hand.
        </p>
      )}

      {canEdit ? (
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 rounded-field bg-surface-container-low p-4">
          <p className="text-label-bold text-on-surface">Add or update a price</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <ItemSelect
              id="price-item"
              label="Item"
              value={form.itemId}
              onChange={(event) => set({ itemId: event.target.value })}
              items={available}
              error={errors.itemId}
            />
            <Field
              id="price-unit"
              label="Price"
              inputMode="decimal"
              value={form.unitPrice}
              onChange={(event) => set({ unitPrice: event.target.value })}
              error={errors.unitPrice}
              hint="Per the item's own unit."
              autoComplete="off"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="price-sku" label="Their code" value={form.supplierSku} onChange={(event) => set({ supplierSku: event.target.value })} hint="Optional — what they call it." autoComplete="off" />
            <Field id="price-min" label="Minimum order" inputMode="decimal" value={form.minOrderQuantity} onChange={(event) => set({ minOrderQuantity: event.target.value })} error={errors.minOrderQuantity} hint="Optional." autoComplete="off" />
            <Field id="price-lead" label="Lead time (days)" inputMode="numeric" value={form.leadTimeDays} onChange={(event) => set({ leadTimeDays: event.target.value })} error={errors.leadTimeDays} hint="Optional." autoComplete="off" />
          </div>
          <label htmlFor="price-preferred" className="flex items-start gap-3 text-body-md text-on-surface">
            <input
              id="price-preferred"
              type="checkbox"
              checked={form.isPreferred}
              onChange={(event) => set({ isPreferred: event.target.checked })}
              className="mt-1 size-4 accent-primary"
            />
            <span>
              Buy this item from here by default
              <span className="block text-label-bold font-normal text-on-surface-variant">
                One supplier per item. Ticking this unmarks whoever holds it now.
              </span>
            </span>
          </label>
          <button
            type="submit"
            disabled={pending}
            className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {pending ? "Saving…" : "Save price"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
