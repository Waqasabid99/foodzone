"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { issuePayload } from "@/lib/production";
import FormAlert from "@/components/ui/FormAlert";
import ItemSelect from "@/components/dashboard/inventory/ItemSelect";

let nextKey = 0;
const blank = () => ({ key: `extra-${(nextKey += 1)}`, itemId: "", quantity: "" });

/**
 * Takes more out for a batch already under way — the dough was dry and took
 * another litre. Recorded as its own issue, so the batch shows what really
 * went into it.
 */
export default function IssueMaterialForm({ run, items }) {
  const router = useRouter();
  const [lines, setLines] = useState(() => [blank()]);
  const [lineErrors, setLineErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const change = (key, patch) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const itemById = new Map(items.map((item) => [item.id, item]));

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const { body, lineErrors: problems, error } = issuePayload(lines);
    setLineErrors(problems);
    if (error) return setFormError(error);
    setPending(true);
    setFormError(null);
    try {
      await api.post(`/admin/production-orders/${run.id}/consume`, body);
      toast.success("Taken out of stock for this batch.");
      setLines([blank()]);
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be taken out.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
      <FormAlert>{formError}</FormAlert>
      <ul className="flex flex-col gap-2">
        {lines.map((line, index) => {
          const problems = lineErrors[index] ?? {};
          const unit = itemById.get(line.itemId)?.uom;
          return (
            <li key={line.key} className="grid gap-2 rounded-field bg-surface-container-low p-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
              <ItemSelect id={`${line.key}-item`} label="Item" value={line.itemId} onChange={(event) => change(line.key, { itemId: event.target.value })} items={items} error={problems.itemId} />
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${line.key}-quantity`} className="text-label-bold text-on-surface">Amount{unit ? ` (${unit.code})` : ""}</label>
                <input
                  id={`${line.key}-quantity`}
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(event) => change(line.key, { quantity: event.target.value })}
                  aria-invalid={problems.quantity ? "true" : undefined}
                  className={`w-full rounded-field bg-surface-container-lowest px-3 py-3 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring ${problems.quantity ? "border border-error" : "border border-transparent"}`}
                />
                {problems.quantity ? <p className="text-label-bold text-error">{problems.quantity}</p> : null}
              </div>
              {lines.length > 1 ? (
                <button type="button" aria-label={`Remove line ${index + 1}`} onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))} className="inline-flex min-h-11 items-center justify-center rounded-field px-3 text-error hover:bg-surface-container">
                  <Trash2 aria-hidden="true" className="size-4" />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => setLines((current) => [...current, blank()])} className="inline-flex items-center gap-2 rounded-field px-3 py-2 text-label-bold text-primary hover:underline">
          <Plus aria-hidden="true" className="size-4" />
          Another item
        </button>
        <button type="submit" disabled={pending} className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {pending ? "Taking out…" : "Take out"}
        </button>
      </div>
    </form>
  );
}
