"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { orderTotals, purchaseOrderPayload } from "@/lib/purchasing";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";
import ItemSelect from "@/components/dashboard/inventory/ItemSelect";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";

let nextKey = 0;
const blankLine = () => ({
  key: `po-${(nextKey += 1)}`,
  itemId: "",
  quantity: "",
  unitPrice: "",
  taxRate: "",
  discountAmount: "",
});

const fromOrder = (order) =>
  (order?.items ?? []).map((line) => ({
    key: `po-${(nextKey += 1)}`,
    itemId: line.itemId,
    quantity: String(line.quantity),
    unitPrice: String(line.unitPrice),
    taxRate: Number(line.taxRate) ? String(line.taxRate) : "",
    discountAmount: Number(line.discountAmount) ? String(line.discountAmount) : "",
  }));

/**
 * Raising an order.
 *
 * Prices open on the supplier's agreed list, which is the point of keeping
 * one: a buyer sees what was negotiated rather than recalling it, and a rise
 * becomes a visible change instead of a number nobody questions. The price
 * stays editable, because the agreed list goes stale and a phone call is still
 * how most of this business is done.
 *
 * The totals shown are worked out the same way the server works them out —
 * discount off the line first, then tax on what is left — so the figure
 * somebody approves is the figure that gets sent.
 */
export default function PurchaseOrderForm({ branches, suppliers, items, order = null, priceLists = {}, defaultSupplierId = "" }) {
  const router = useRouter();
  const editing = Boolean(order);

  const [branchId, setBranchId] = useState(order?.branchId ?? (branches.length === 1 ? branches[0].id : ""));
  const [supplierId, setSupplierId] = useState(order?.supplierId ?? defaultSupplierId);
  const [expectedAt, setExpectedAt] = useState(order?.expectedAt ? String(order.expectedAt).slice(0, 10) : "");
  const [shippingCost, setShipping] = useState(order && Number(order.shippingCost) ? String(order.shippingCost) : "");
  const [notes, setNotes] = useState(order?.notes ?? "");
  const [lines, setLines] = useState(() => (editing ? fromOrder(order) : [blankLine()]));
  const [prices, setPrices] = useState(() => priceLists[order?.supplierId ?? defaultSupplierId] ?? {});
  const [errors, setErrors] = useState({});
  const [lineErrors, setLineErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const currency = branches.find((row) => row.id === branchId)?.currency ?? "PKR";
  const change = (key, patch) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  /**
   * The price list follows the supplier.
   *
   * Fetched when somebody picks one rather than shipped for every supplier in
   * the company: a restaurant with fifty suppliers and a thousand items would
   * otherwise send the whole book down to draw one form.
   *
   * Only empty price boxes are filled. A price typed by hand survives a change
   * of supplier, because retyping what the invoice actually said is worse than
   * seeing it beside a different agreed figure.
   */
  async function chooseSupplier(nextId) {
    setSupplierId(nextId);
    if (!nextId) return setPrices({});

    const fallback = priceLists[nextId] ?? {};
    setPrices(fallback);
    try {
      const supplier = await api.get(`/admin/suppliers/${nextId}`);
      const list = Object.fromEntries(
        (supplier.items ?? []).map((row) => [row.item.id, { unitPrice: String(row.unitPrice), uomCode: row.uom?.code ?? null }]),
      );
      setPrices(list);
      setLines((current) => current.map((line) => (line.unitPrice || !list[line.itemId] ? line : { ...line, unitPrice: list[line.itemId].unitPrice })));
    } catch {
      // The agreed prices are a convenience; the form still works without them.
    }
  }

  /** Choosing an item fills its agreed price, and only an empty box. */
  function pickItem(key, itemId) {
    const agreed = prices[itemId];
    setLines((current) =>
      current.map((line) =>
        line.key === key ? { ...line, itemId, unitPrice: line.unitPrice || (agreed ? agreed.unitPrice : "") } : line,
      ),
    );
  }

  const totals = orderTotals(lines, { shippingCost });

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    const { body, errors: local, lineErrors: perLine } = purchaseOrderPayload({
      branchId,
      supplierId,
      expectedAt,
      shippingCost,
      notes,
      lines,
    });
    setErrors(local);
    setLineErrors(perLine);
    if (Object.keys(local).length) return setFormError("Some fields need attention.");

    setPending(true);
    setFormError(null);
    try {
      if (editing) {
        const { branchId: _branch, supplierId: _supplier, ...editable } = body;
        await api.patch(`/admin/purchase-orders/${order.id}`, editable);
        toast.success(`${order.poNumber} saved.`);
        router.push(`/dashboard/purchase-orders/${order.id}`);
      } else {
        const created = await api.post("/admin/purchase-orders", body);
        toast.success(`${created.poNumber} created. Send it for approval when it is right.`);
        router.push(`/dashboard/purchase-orders/${created.id}`);
      }
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be saved.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <FormAlert>{formError}</FormAlert>

      <Section title="Who and when">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="po-supplier"
            label="Supplier"
            value={supplierId}
            onChange={(event) => chooseSupplier(event.target.value)}
            options={[{ value: "", label: "Choose a supplier" }, ...suppliers.map((row) => ({ value: row.id, label: row.name }))]}
            error={errors.supplierId}
            disabled={editing}
            hint={editing ? "The supplier cannot be changed on an existing order — raise a new one." : undefined}
          />
          {branches.length > 1 || editing ? (
            <SelectField
              id="po-branch"
              label="Buying for"
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
              options={[{ value: "", label: "Choose a branch" }, ...branches.map((row) => ({ value: row.id, label: row.name }))]}
              error={errors.branchId}
              disabled={editing}
              hint={editing ? "Fixed once the order exists." : "Whose kitchen the food is for, and whose books it lands on."}
            />
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="po-expected"
            label="Expected"
            type="date"
            value={expectedAt}
            onChange={(event) => setExpectedAt(event.target.value)}
            hint="When they said it would arrive. Optional, but it is what makes a late delivery visible."
          />
          <Field
            id="po-shipping"
            label="Delivery charge"
            inputMode="decimal"
            value={shippingCost}
            onChange={(event) => setShipping(event.target.value)}
            error={errors.shippingCost}
            hint="Optional. Added to the order total."
            autoComplete="off"
          />
        </div>
      </Section>

      <Section title="What is being ordered" description="Prices open on what was agreed with this supplier. Change one if it has moved.">
        <ul className="flex flex-col gap-3">
          {lines.map((line, index) => {
            const item = itemById.get(line.itemId);
            const agreed = prices[line.itemId];
            const problems = lineErrors[index] ?? {};
            const preview = totals.lines[index];
            return (
              <li key={line.key} className="flex flex-col gap-3 rounded-field bg-surface-container-low p-4">
                <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr] sm:items-start">
                  <ItemSelect
                    id={`${line.key}-item`}
                    label="Item"
                    value={line.itemId}
                    onChange={(event) => pickItem(line.key, event.target.value)}
                    items={items}
                    error={problems.itemId}
                  />
                  <Field
                    id={`${line.key}-quantity`}
                    label={`Quantity${item ? ` (${agreed?.uomCode ?? item.uom.code})` : ""}`}
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={(event) => change(line.key, { quantity: event.target.value })}
                    error={problems.quantity}
                    autoComplete="off"
                  />
                  <Field
                    id={`${line.key}-price`}
                    label="Unit price"
                    inputMode="decimal"
                    value={line.unitPrice}
                    onChange={(event) => change(line.key, { unitPrice: event.target.value })}
                    error={problems.unitPrice}
                    hint={agreed ? `Agreed: ${formatMoney(agreed.unitPrice, currency)}` : line.itemId ? "Not on their price list." : undefined}
                    autoComplete="off"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <Field
                    id={`${line.key}-tax`}
                    label="Tax %"
                    inputMode="decimal"
                    value={line.taxRate}
                    onChange={(event) => change(line.key, { taxRate: event.target.value })}
                    error={problems.taxRate}
                    autoComplete="off"
                  />
                  <Field
                    id={`${line.key}-discount`}
                    label="Discount"
                    inputMode="decimal"
                    value={line.discountAmount}
                    onChange={(event) => change(line.key, { discountAmount: event.target.value })}
                    error={problems.discountAmount}
                    hint="Off this line, before tax."
                    autoComplete="off"
                  />
                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <p className="text-body-md tabular-nums text-on-surface">
                      <span className="text-label-bold font-normal text-on-surface-variant">Line </span>
                      {formatMoney(preview?.lineTotal ?? 0, currency)}
                    </p>
                    {lines.length > 1 ? (
                      <button
                        type="button"
                        aria-label="Remove this line"
                        onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))}
                        className="rounded-field px-3 py-3 text-error hover:bg-surface-container"
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {errors.items ? <p className="text-label-bold text-error">{errors.items}</p> : null}
        <button
          type="button"
          onClick={() => setLines((current) => [...current, blankLine()])}
          className="inline-flex w-fit items-center gap-2 rounded-field px-3 py-2 text-label-bold text-primary hover:underline"
        >
          <Plus aria-hidden="true" className="size-4" />
          Add another item
        </button>

        <dl className="grid gap-2 rounded-field bg-surface-container p-4 text-body-md">
          <div className="flex justify-between gap-4">
            <dt className="text-on-surface-variant">Goods</dt>
            <dd className="tabular-nums text-on-surface">{formatMoney(totals.subtotal, currency)}</dd>
          </div>
          {Number(totals.discountTotal) ? (
            <div className="flex justify-between gap-4">
              <dt className="text-on-surface-variant">Discount</dt>
              <dd className="tabular-nums text-on-surface">−{formatMoney(totals.discountTotal, currency)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4">
            <dt className="text-on-surface-variant">Tax</dt>
            <dd className="tabular-nums text-on-surface">{formatMoney(totals.taxTotal, currency)}</dd>
          </div>
          {Number(totals.shippingCost) ? (
            <div className="flex justify-between gap-4">
              <dt className="text-on-surface-variant">Delivery</dt>
              <dd className="tabular-nums text-on-surface">{formatMoney(totals.shippingCost, currency)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4 border-t border-outline-variant pt-2">
            <dt className="text-label-bold text-on-surface">Order total</dt>
            <dd className="text-label-bold tabular-nums text-on-surface">{formatMoney(totals.grandTotal, currency)}</dd>
          </div>
        </dl>
      </Section>

      <Section title="Anything else">
        <TextAreaField
          id="po-notes"
          label="Note for the supplier"
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Delivery window, gate to use, who to ask for"
        />
      </Section>

      <div className="min-w-48 max-w-xs">
        <SubmitButton pending={pending} pendingLabel="Saving…">{editing ? "Save order" : "Create order"}</SubmitButton>
      </div>
      <p className="text-body-md text-on-surface-variant">
        Creating an order promises nothing and moves no stock. It is sent for approval next, and food appears only when
        a delivery is received against it.
      </p>
    </form>
  );
}
