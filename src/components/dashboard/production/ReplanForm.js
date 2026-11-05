"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { parseQuantity } from "@/lib/inventory";
import { decimalText } from "@/lib/production";

/** Changes how much a planned batch makes. Only while nothing has been taken out. */
export default function ReplanForm({ run }) {
  const router = useRouter();
  const [value, setValue] = useState(decimalText(run.plannedQuantity));
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const unchanged = value.trim() === decimalText(run.plannedQuantity);

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending || unchanged) return;
    const parsed = parseQuantity(value);
    if (parsed.error) return setError(parsed.error);
    setPending(true);
    setError(null);
    try {
      await api.patch(`/admin/production-orders/${run.id}`, { plannedQuantity: parsed.value });
      toast.success("Batch size changed.");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "It could not be changed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-wrap items-end gap-3">
      <div className="flex min-w-40 flex-col gap-1.5">
        <label htmlFor="replan-quantity" className="text-label-bold text-on-surface">Make ({run.recipe.yieldUom.code})</label>
        <input
          id="replan-quantity"
          inputMode="decimal"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={error ? "true" : undefined}
          className={`w-full rounded-field bg-surface-container-lowest px-3 py-2.5 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring ${error ? "border border-error" : "border border-transparent"}`}
        />
      </div>
      <button type="submit" disabled={pending || unchanged} className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {pending ? "Saving…" : "Change amount"}
      </button>
      {error ? <p className="w-full text-label-bold text-error">{error}</p> : null}
    </form>
  );
}
