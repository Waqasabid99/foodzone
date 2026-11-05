"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { formatQuantity } from "@/lib/inventory";
import { dayKey, goodsReceiptPayload, receiptTotals } from "@/lib/purchasing";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";
import ItemSelect from "@/components/dashboard/inventory/ItemSelect";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";

let nextKey = 0;
const blankLine = () => ({
  key: `grn-${(nextKey += 1)}`,
  itemId: "",
  quantity: "",
  rejectedQuantity: "",
  unitCost: "",
  batchNumber: "",
  expiryDate: "",
});

/** An order's outstanding lines, pre-filled with what is still expected. */
const fromOrder = (order) =>
  (order?.items ?? [])
    .filter((line) => Number(line.outstanding) > 0)
    .map((line) => ({
      key: `grn-${(nextKey += 1)}`,
      itemId: line.itemId,
      purchaseOrderItemId: line.id,
      uomId: line.uomId,
      uomCode: line.uom?.code ?? line.item.uom?.code ?? null,
      outstanding: line.outstanding,
      name: line.item.name,
      quantity: String(line.outstanding),
      rejectedQuantity: "",
      unitCost: String(line.unitPrice),
      taxRate: Number(line.taxRate) ? String(line.taxRate) : "",
      batchNumber: "",
      expiryDate: "",
      optional: true,
    }));

/**
 * Receiving a delivery.
 *
 * This is the write that matters most in the whole section: it is the moment
 * food becomes stock the kitchen can cook and money the restaurant owes. Three
 * things the form insists on, each because getting it wrong is expensive:
 *
 *   * **Delivered and rejected are separate boxes.** What the driver brought
 *     and what the chef accepted are two facts. Subtracting one from the other
 *     in your head loses the argument a month later when the invoice arrives
 *     for the full load.
 *   * **The order's quantities are a starting point, not an answer.** They
 *     open on what is outstanding because that is usually right, and every one
 *     is editable because a delivery is frequently not.
 *   * **Nothing moves until it is posted.** Saving this is a draft, so a
 *     half-checked delivery can be left and finished.
 */
export default function ReceiveForm({ locations, suppliers, items, order = null, defaults = {} }) {
  const router = useRouter();

  const [locationId, setLocation] = useState(defaults.locationId ?? (locations.length === 1 ? locations[0].id : ""));
  const [supplierId, setSupplier] = useState(order?.supplierId ?? defaults.supplierId ?? "");
  const [invoiceNumber, setInvoice] = useState("");
  const [receivedAt, setReceivedAt] = useState(dayKey());
  const [landedCost, setLanded] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState(() => (order ? fromOrder(order) : [blankLine()]));
  const [errors, setErrors] = useState({});
  const [lineErrors, setLineErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const location = locations.find((row) => row.id === locationId);
  const currency = location?.branch?.currency ?? order?.currency ?? "PKR";
  const change = (key, patch) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const tracksBatches = (itemId) => Boolean(itemById.get(itemId)?.trackBatches);

  const totals = receiptTotals(lines);

  function pickItem(key, itemId) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, itemId } : line)));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    const { body, errors: local, lineErrors: perLine } = goodsReceiptPayload({
      locationId,
      supplierId,
      purchaseOrderId: order?.id,
      supplierInvoiceNumber: invoiceNumber,
      receivedAt,
      landedCost,
      notes,
      lines,
      tracksBatches,
    });
    setErrors(local);
    setLineErrors(perLine);
    if (Object.keys(local).length) return setFormError("Some lines need attention.");

    setPending(true);
    setFormError(null);
    try {
      const created = await api.post("/admin/goods-receipts", body);
      toast.success(`${created.grnNumber} saved as a draft. Post it to put the stock in.`);
      router.push(`/dashboard/goods-receipts/${created.id}`);
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be saved.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <FormAlert>{formError}</FormAlert>

      <Section title="The delivery">
        {order ? (
          <p className="rounded-field bg-secondary-container px-4 py-3 text-body-md text-on-secondary-container">
            Receiving against <strong>{order.poNumber}</strong> from {order.supplier.name}. Quantities open on what is
            still outstanding — change any that arrived short, and leave a line blank if none of it came.
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="grn-supplier"
            label="Delivered by"
            value={supplierId}
            onChange={(event) => setSupplier(event.target.value)}
            options={[{ value: "", label: "Choose a supplier" }, ...suppliers.map((row) => ({ value: row.id, label: row.name }))]}
            error={errors.supplierId}
            disabled={Boolean(order)}
            hint={order ? "Taken from the order." : undefined}
          />
          <SelectField
            id="grn-location"
            label="Goes into"
            value={locationId}
            onChange={(event) => setLocation(event.target.value)}
            options={[
              { value: "", label: "Choose a store room" },
              ...locations.map((row) => ({ value: row.id, label: `${row.name} — ${row.branch.name}` })),
            ]}
            error={errors.locationId}
            hint="Where the stock physically lands."
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="grn-date" label="Arrived on" type="date" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} />
          <Field
            id="grn-invoice"
            label="Their invoice number"
            value={invoiceNumber}
            onChange={(event) => setInvoice(event.target.value)}
            hint="Off the delivery note. Optional."
            autoComplete="off"
          />
          <Field
            id="grn-landed"
            label="Freight"
            inputMode="decimal"
            value={landedCost}
            onChange={(event) => setLanded(event.target.value)}
            error={errors.landedCost}
            hint="Spread across the lines by value, so it lands in the cost of the food."
            autoComplete="off"
          />
        </div>
      </Section>

      <Section
        title="What actually arrived"
        description="Delivered is what they brought. Rejected is what was sent back or thrown away — it never enters stock and is not paid for."
      >
        <ul className="flex flex-col gap-3">
          {lines.map((line, index) => {
            const item = itemById.get(line.itemId);
            const unit = line.uomCode ?? item?.uom?.code ?? null;
            const problems = lineErrors[index] ?? {};
            const preview = totals.lines[index];
            return (
              <li key={line.key} className="flex flex-col gap-3 rounded-field bg-surface-container-low p-4">
                <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr] sm:items-start">
                  {order ? (
                    <div className="flex flex-col gap-1">
                      <p className="text-label-bold text-on-surface">{line.name}</p>
                      <p className="text-label-bold font-normal text-on-surface-variant">
                        {formatQuantity(line.outstanding, { unit })} still expected
                      </p>
                    </div>
                  ) : (
                    <ItemSelect
                      id={`${line.key}-item`}
                      label="Item"
                      value={line.itemId}
                      onChange={(event) => pickItem(line.key, event.target.value)}
                      items={items}
                      error={problems.itemId}
                    />
                  )}
                  <Field
                    id={`${line.key}-quantity`}
                    label={`Delivered${unit ? ` (${unit})` : ""}`}
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={(event) => change(line.key, { quantity: event.target.value })}
                    error={problems.quantity}
                    autoComplete="off"
                  />
                  <Field
                    id={`${line.key}-rejected`}
                    label="Rejected"
                    inputMode="decimal"
                    value={line.rejectedQuantity}
                    onChange={(event) => change(line.key, { rejectedQuantity: event.target.value })}
                    error={problems.rejectedQuantity}
                    hint="Spoiled, short-dated, wrong."
                    autoComplete="off"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr] sm:items-start">
                  <Field
                    id={`${line.key}-cost`}
                    label="Price paid"
                    inputMode="decimal"
                    value={line.unitCost}
                    onChange={(event) => change(line.key, { unitCost: event.target.value })}
                    error={problems.unitCost}
                    hint={order ? "From the order. Change it if they charged something else." : undefined}
                    autoComplete="off"
                  />
                  {tracksBatches(line.itemId) ? (
                    <>
                      <Field
                        id={`${line.key}-batch`}
                        label="Batch number"
                        value={line.batchNumber}
                        onChange={(event) => change(line.key, { batchNumber: event.target.value })}
                        hint="Off the label. Left blank, the receipt number is used."
                        autoComplete="off"
                      />
                      <Field
                        id={`${line.key}-expiry`}
                        label="Use by"
                        type="date"
                        value={line.expiryDate}
                        onChange={(event) => change(line.key, { expiryDate: event.target.value })}
                        hint="Left blank, the item's shelf life decides."
                      />
                    </>
                  ) : null}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <p className="text-body-md tabular-nums text-on-surface">
                    <span className="text-label-bold font-normal text-on-surface-variant">Accepted </span>
                    {formatQuantity(preview?.accepted ?? 0, { unit })}
                    <span className="text-label-bold font-normal text-on-surface-variant"> · </span>
                    {formatMoney(preview?.lineTotal ?? 0, currency)}
                  </p>
                  {!order && lines.length > 1 ? (
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
              </li>
            );
          })}
        </ul>

        {errors.items ? <p className="text-label-bold text-error">{errors.items}</p> : null}

        {order ? null : (
          <button
            type="button"
            onClick={() => setLines((current) => [...current, blankLine()])}
            className="inline-flex w-fit items-center gap-2 rounded-field px-3 py-2 text-label-bold text-primary hover:underline"
          >
            <Plus aria-hidden="true" className="size-4" />
            Add another item
          </button>
        )}

        <dl className="grid gap-2 rounded-field bg-surface-container p-4 text-body-md">
          <div className="flex justify-between gap-4">
            <dt className="text-on-surface-variant">Goods accepted</dt>
            <dd className="tabular-nums text-on-surface">{formatMoney(totals.subtotal, currency)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-on-surface-variant">Tax</dt>
            <dd className="tabular-nums text-on-surface">{formatMoney(totals.taxTotal, currency)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-outline-variant pt-2">
            <dt className="text-label-bold text-on-surface">Delivery total</dt>
            <dd className="text-label-bold tabular-nums text-on-surface">
              {formatMoney(receiptTotals(lines, { landedCost }).grandTotal, currency)}
            </dd>
          </div>
        </dl>
      </Section>

      <Section title="Anything else">
        <TextAreaField
          id="grn-notes"
          label="Note"
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Who checked it in, what was wrong with the rejected stock"
        />
      </Section>

      <div className="min-w-48 max-w-xs">
        <SubmitButton pending={pending} pendingLabel="Saving…">Save as draft</SubmitButton>
      </div>
      <p className="text-body-md text-on-surface-variant">
        Saving moves nothing. The stock goes in when the receipt is posted, which is also when the order updates and
        the restaurant starts owing for it.
      </p>
    </form>
  );
}
