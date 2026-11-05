"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { YIELD_LOSS_REASONS, completeRunPayload, decimalText, localDate } from "@/lib/production";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import FormAlert from "@/components/ui/FormAlert";

/**
 * Finishes a run: what came out goes into stock at what the batch cost.
 *
 * Anything made but not usable is entered as waste. It goes in and straight
 * out again, recorded against this run, so the loss is a costed number rather
 * than a quiet rise in the cost of what survived.
 */
export default function CompleteRunForm({ run, includeCost = false }) {
  const router = useRouter();
  const unit = run.recipe.yieldUom;
  const tracked = Boolean(run.recipe.outputItem?.trackBatches);
  const [form, setForm] = useState({
    producedQuantity: decimalText(run.plannedQuantity),
    wastedQuantity: "",
    wastageReason: "PRODUCTION_LOSS",
    wastageNotes: "",
    laborCost: "",
    overheadCost: "",
    batchNumber: run.batchNumber ?? "",
    expiryDate: "",
    notes: "",
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const wasted = Number(String(form.wastedQuantity).replace(/,/g, "")) > 0;
  const shelfLife = run.recipe.outputItem?.isPerishable && run.recipe.outputItem?.shelfLifeDays;

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const { body, errors: local } = completeRunPayload(form, { includeCost, tracked, today: localDate() });
    setErrors(local);
    if (Object.keys(local).length) return setFormError("Some fields need attention.");
    if (!window.confirm(`Finish ${run.productionNumber}? What came out goes into stock now, and the batch cannot be reopened.`)) return;
    setPending(true);
    setFormError(null);
    try {
      await api.post(`/admin/production-orders/${run.id}/complete`, body);
      toast.success(`${run.productionNumber} is done and in stock.`);
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be finished.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <FormAlert>{formError}</FormAlert>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="complete-produced" label={`Usable, went into stock (${unit.code})`} inputMode="decimal" value={form.producedQuantity} onChange={(event) => set({ producedQuantity: event.target.value })} error={errors.producedQuantity} />
        <Field id="complete-wasted" label={`Made but not usable (${unit.code})`} inputMode="decimal" placeholder="0" value={form.wastedQuantity} onChange={(event) => set({ wastedQuantity: event.target.value })} error={errors.wastedQuantity} hint="Burnt, spilled, failed — booked as waste against this batch." />
      </div>
      {wasted ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField id="complete-reason" label="Why it was lost" value={form.wastageReason} onChange={(event) => set({ wastageReason: event.target.value })} options={YIELD_LOSS_REASONS} />
          <Field id="complete-waste-notes" label="What happened" value={form.wastageNotes} onChange={(event) => set({ wastageNotes: event.target.value })} error={errors.wastageNotes} hint={form.wastageReason === "OTHER" ? "Needed for “Something else”." : "Optional."} />
        </div>
      ) : null}
      {tracked ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="complete-batch" label="Batch number" value={form.batchNumber} onChange={(event) => set({ batchNumber: event.target.value })} error={errors.batchNumber} hint={`Blank uses ${run.productionNumber}.`} />
          <Field id="complete-expiry" label="Use by" type="date" value={form.expiryDate} onChange={(event) => set({ expiryDate: event.target.value })} error={errors.expiryDate} hint={shelfLife ? `Blank counts ${shelfLife} ${shelfLife === 1 ? "day" : "days"} from now.` : "Optional."} />
        </div>
      ) : null}
      {includeCost ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="complete-labor" label="Labour for this batch" inputMode="decimal" placeholder="From the recipe" value={form.laborCost} onChange={(event) => set({ laborCost: event.target.value })} error={errors.laborCost} hint="Blank uses the recipe's, scaled to what was made." />
          <Field id="complete-overhead" label="Overhead for this batch" inputMode="decimal" placeholder="From the recipe" value={form.overheadCost} onChange={(event) => set({ overheadCost: event.target.value })} error={errors.overheadCost} />
        </div>
      ) : null}
      <TextAreaField id="complete-notes" label="Notes" rows={2} value={form.notes} onChange={(event) => set({ notes: event.target.value })} error={errors.notes} hint="Optional." />
      <button type="submit" disabled={pending} className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {pending ? "Finishing…" : "Finish — put it into stock"}
      </button>
    </form>
  );
}
