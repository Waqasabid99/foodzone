"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { adjustmentPayload, formatQuantity } from "@/lib/inventory";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";
import ItemSelect from "@/components/dashboard/inventory/ItemSelect";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";

let nextKey = 0;
const blankLine = (itemId = "") => ({ key: `line-${(nextKey += 1)}`, itemId, direction: "add", quantity: "", unitCost: "", note: "", batchNumber: "", expiryDate: "" });

const inputClass = (invalid) =>
  `w-full rounded-field bg-surface-container-lowest px-3 py-3 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring ${invalid ? "border border-error" : "border border-outline"}`;

function Field({ id, label, error, hint, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label-bold text-on-surface">{label}</label>
      {children}
      {error ? <p className="text-label-bold text-error">{error}</p> : hint ? <p className="text-label-bold font-normal text-on-surface-variant">{hint}</p> : null}
    </div>
  );
}

/** Today in the viewer's own calendar, as the date input writes it. */
function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Raises an adjustment. Nothing moves until someone approves it.
 *
 * Each line shows what the system thinks is there now, so the person raising
 * it and the person approving it are looking at the same before-and-after.
 */
export default function AdjustmentForm({ type = "CORRECTION", locations, items, levels, defaultItemId = "", defaultLocationId = "" }) {
  const opening = type === "OPENING_STOCK";
  const router = useRouter();
  const [locationId, setLocationId] = useState(defaultLocationId || (locations.length === 1 ? locations[0].id : ""));
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState(() => [blankLine(defaultItemId)]);
  const [errors, setErrors] = useState({});
  const [lineErrors, setLineErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const multiBranch = new Set(locations.map((location) => location.branchId)).size > 1;
  const change = (key, patch) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const { body, errors: local, lineErrors: perLine } = adjustmentPayload({
      type,
      locationId,
      reason,
      lines,
      isTracked: (itemId) => Boolean(itemById.get(itemId)?.trackBatches),
      today: localToday(),
    });
    setErrors(local);
    setLineErrors(perLine);
    if (Object.keys(local).length) {
      setFormError(local.lines && Object.keys(local).length === 1 ? local.lines : "Some fields need attention.");
      return;
    }
    setPending(true);
    setFormError(null);
    try {
      const created = await api.post("/admin/stock-adjustments", body);
      toast.success(`${opening ? "Opening stock" : "Adjustment"} ${created.adjustmentNumber} is waiting for approval.`);
      router.push(`/dashboard/stock-adjustments/${created.id}`);
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be saved.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <FormAlert>{formError}</FormAlert>

      <Section title="Where, and why">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="adjustment-location"
            label="Location"
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
            options={[{ value: "", label: "Choose a location" }, ...locations.map((location) => ({ value: location.id, label: multiBranch ? `${location.name} — ${location.branch.name}` : location.name }))]}
            error={errors.locationId}
          />
        </div>
        <TextAreaField
          id="adjustment-reason"
          label="Reason"
          rows={2}
          placeholder={opening ? "e.g. Stock on the shelf on 1 October, when we started" : "e.g. Box of flour found behind the freezer"}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={errors.reason}
          hint="The approver decides on this, so say what happened."
        />
      </Section>

      <Section
        title="Items"
        description={
          opening
            ? "What is on the shelf here right now, and what it cost. Each item once — this is its starting balance."
            : "Add what was found or brought in; remove what is missing or was used without a record."
        }
      >
        <ul className="flex flex-col gap-3">
          {lines.map((line, index) => {
            const item = itemById.get(line.itemId);
            const onHand = locationId && line.itemId ? levels[`${locationId}:${line.itemId}`] ?? "0" : null;
            const problems = lineErrors[index] ?? {};
            const qty = (value) => formatQuantity(value, { precision: item?.uom.precision ?? 3, unit: item?.uom.code });
            const typed = Number(String(line.quantity).replace(/,/g, ""));
            const adding = opening || line.direction === "add";
            const after = onHand != null && Number.isFinite(typed) && typed > 0 ? Number(onHand) + (adding ? typed : -typed) : null;
            const tracked = adding && item?.trackBatches;

            return (
              <li key={line.key} className="flex flex-col gap-3 rounded-field bg-surface-container-low p-4">
                <div className={`grid gap-3 ${opening ? "sm:grid-cols-[2fr_1fr]" : "sm:grid-cols-[2fr_1fr_1fr]"}`}>
                  <ItemSelect id={`${line.key}-item`} label="Item" value={line.itemId} onChange={(event) => change(line.key, { itemId: event.target.value })} items={items} error={problems.itemId} />
                  {opening ? null : (
                    <SelectField
                      id={`${line.key}-direction`}
                      label="Change"
                      value={line.direction}
                      onChange={(event) => change(line.key, { direction: event.target.value })}
                      options={[
                        { value: "add", label: "Add to stock" },
                        { value: "remove", label: "Remove from stock" },
                      ]}
                    />
                  )}
                  <Field id={`${line.key}-quantity`} label={`${opening ? "On the shelf" : "Quantity"}${item ? ` (${item.uom.code})` : ""}`} error={problems.quantity}>
                    <input
                      id={`${line.key}-quantity`}
                      inputMode="decimal"
                      value={line.quantity}
                      onChange={(event) => change(line.key, { quantity: event.target.value })}
                      aria-invalid={problems.quantity ? "true" : undefined}
                      className={inputClass(problems.quantity)}
                    />
                  </Field>
                </div>

                {tracked ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id={`${line.key}-batch`} label="Batch number" error={problems.batchNumber} hint="Blank gives it this adjustment's number.">
                      <input
                        id={`${line.key}-batch`}
                        value={line.batchNumber}
                        onChange={(event) => change(line.key, { batchNumber: event.target.value })}
                        aria-invalid={problems.batchNumber ? "true" : undefined}
                        className={inputClass(problems.batchNumber)}
                      />
                    </Field>
                    <Field
                      id={`${line.key}-expiry`}
                      label="Use by"
                      error={problems.expiryDate}
                      hint={item.isPerishable && item.shelfLifeDays ? `Blank counts ${item.shelfLifeDays} ${item.shelfLifeDays === 1 ? "day" : "days"} from approval — set the real date if it is older.` : "Optional."}
                    >
                      <input
                        id={`${line.key}-expiry`}
                        type="date"
                        value={line.expiryDate}
                        onChange={(event) => change(line.key, { expiryDate: event.target.value })}
                        aria-invalid={problems.expiryDate ? "true" : undefined}
                        className={inputClass(problems.expiryDate)}
                      />
                    </Field>
                  </div>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
                  {adding ? (
                    <Field
                      id={`${line.key}-cost`}
                      label={`Cost each${item ? ` per ${item.uom.code}` : ""}`}
                      error={problems.unitCost}
                      hint={opening ? "What you paid for it. The last invoice price is fine." : "Blank uses the item's average."}
                    >
                      <input
                        id={`${line.key}-cost`}
                        inputMode="decimal"
                        placeholder={opening ? "" : "Average cost"}
                        value={line.unitCost}
                        onChange={(event) => change(line.key, { unitCost: event.target.value })}
                        aria-invalid={problems.unitCost ? "true" : undefined}
                        className={inputClass(problems.unitCost)}
                      />
                    </Field>
                  ) : (
                    <div />
                  )}
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`${line.key}-note`} className="text-label-bold text-on-surface">Note</label>
                    <input
                      id={`${line.key}-note`}
                      value={line.note}
                      onChange={(event) => change(line.key, { note: event.target.value })}
                      placeholder="Optional"
                      className="w-full rounded-field border border-outline bg-surface-container-lowest px-3 py-3 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-body-md text-on-surface-variant" aria-live="polite">
                    {onHand != null && item ? (
                      <>
                        Now {qty(onHand)}
                        {after != null ? <> → <span className={after < 0 ? "text-error" : "text-on-surface"}>{qty(String(after))}</span> once approved</> : null}
                      </>
                    ) : locationId ? null : "Choose a location to see what is there."}
                  </p>
                  {lines.length > 1 ? (
                    <button type="button" onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))} className="inline-flex items-center gap-1 rounded-field px-3 py-2 text-label-bold text-error hover:bg-surface-container">
                      <Trash2 aria-hidden="true" className="size-4" />
                      Remove line
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        <button type="button" onClick={() => setLines((current) => [...current, blankLine()])} className="inline-flex w-fit items-center gap-2 rounded-field px-3 py-2 text-label-bold text-primary hover:underline">
          <Plus aria-hidden="true" className="size-4" />
          Add another item
        </button>
      </Section>

      <div className="min-w-48 max-w-xs">
        <SubmitButton pending={pending} pendingLabel="Sending…">Send for approval</SubmitButton>
      </div>
    </form>
  );
}
