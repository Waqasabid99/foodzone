"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatQuantity, transferPayload } from "@/lib/inventory";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";
import ItemSelect from "@/components/dashboard/inventory/ItemSelect";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";

let nextKey = 0;
const blankLine = (itemId = "") => ({ key: `transfer-${(nextKey += 1)}`, itemId, quantity: "" });

/**
 * Plans a transfer. Nothing moves yet: it leaves when someone dispatches it,
 * and arrives when the other end receives it.
 */
export default function TransferForm({ sources, destinations, items, levels, defaultItemId = "" }) {
  const router = useRouter();
  const [fromLocationId, setFrom] = useState(sources.length === 1 ? sources[0].id : "");
  const [toLocationId, setTo] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState(() => [blankLine(defaultItemId)]);
  const [errors, setErrors] = useState({});
  const [lineErrors, setLineErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const change = (key, patch) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const label = (location) => `${location.name} — ${location.branch.name}`;
  const byBranch = (list) => {
    const groups = new Map();
    for (const location of list) {
      if (!groups.has(location.branch.name)) groups.set(location.branch.name, []);
      groups.get(location.branch.name).push(location);
    }
    return groups;
  };
  const destinationGroups = byBranch(destinations.filter((location) => location.id !== fromLocationId));

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const { body, errors: local, lineErrors: perLine } = transferPayload({ fromLocationId, toLocationId, notes, lines });
    setErrors(local);
    setLineErrors(perLine);
    if (Object.keys(local).length) {
      setFormError("Some fields need attention.");
      return;
    }
    setPending(true);
    setFormError(null);
    try {
      const created = await api.post("/admin/stock-transfers", body);
      toast.success(`Transfer ${created.transferNumber} created. Dispatch it when it leaves.`);
      router.push(`/dashboard/stock-transfers/${created.id}`);
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be saved.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <FormAlert>{formError}</FormAlert>

      <Section title="From and to">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="transfer-from"
            label="From"
            value={fromLocationId}
            onChange={(event) => setFrom(event.target.value)}
            options={[{ value: "", label: "Choose where it is now" }, ...sources.map((location) => ({ value: location.id, label: label(location) }))]}
            error={errors.fromLocationId}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="transfer-to" className="text-label-bold text-on-surface">To</label>
            <select
              id="transfer-to"
              value={toLocationId}
              onChange={(event) => setTo(event.target.value)}
              aria-invalid={errors.toLocationId ? "true" : undefined}
              className={`w-full rounded-field bg-surface-container-low px-4 py-3 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring ${errors.toLocationId ? "border border-error" : "border border-transparent"}`}
            >
              <option value="">Choose where it is going</option>
              {[...destinationGroups.entries()].map(([branch, locations]) => (
                <optgroup key={branch} label={branch}>
                  {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                </optgroup>
              ))}
            </select>
            {errors.toLocationId ? <p className="text-label-bold text-error">{errors.toLocationId}</p> : <p className="text-label-bold font-normal text-on-surface-variant">Any location, at any branch.</p>}
          </div>
        </div>
        <TextAreaField id="transfer-notes" label="Note" rows={2} placeholder="Optional — who is taking it, which van" value={notes} onChange={(event) => setNotes(event.target.value)} />
      </Section>

      <Section title="What is going">
        <ul className="flex flex-col gap-3">
          {lines.map((line, index) => {
            const item = itemById.get(line.itemId);
            const available = fromLocationId && line.itemId ? levels[`${fromLocationId}:${line.itemId}`] ?? "0" : null;
            const problems = lineErrors[index] ?? {};
            return (
              <li key={line.key} className="grid gap-3 rounded-field bg-surface-container-low p-4 sm:grid-cols-[2fr_1fr_auto] sm:items-start">
                <ItemSelect id={`${line.key}-item`} label="Item" value={line.itemId} onChange={(event) => change(line.key, { itemId: event.target.value })} items={items} error={problems.itemId} />
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`${line.key}-quantity`} className="text-label-bold text-on-surface">Quantity{item ? ` (${item.uom.code})` : ""}</label>
                  <input
                    id={`${line.key}-quantity`}
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={(event) => change(line.key, { quantity: event.target.value })}
                    aria-invalid={problems.quantity ? "true" : undefined}
                    className={`w-full rounded-field bg-surface-container-lowest px-3 py-3 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring ${problems.quantity ? "border border-error" : "border border-transparent"}`}
                  />
                  {problems.quantity ? (
                    <p className="text-label-bold text-error">{problems.quantity}</p>
                  ) : available != null && item ? (
                    <p className="text-label-bold font-normal text-on-surface-variant">{formatQuantity(available, { precision: item.uom.precision, unit: item.uom.code })} there</p>
                  ) : null}
                </div>
                {lines.length > 1 ? (
                  <button type="button" aria-label="Remove this line" onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))} className="inline-flex items-center gap-1 self-end rounded-field px-3 py-3 text-label-bold text-error hover:bg-surface-container">
                    <Trash2 aria-hidden="true" className="size-4" />
                  </button>
                ) : null}
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
        <SubmitButton pending={pending} pendingLabel="Saving…">Create transfer</SubmitButton>
      </div>
    </form>
  );
}
