"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { formatQuantity, parseQuantity } from "@/lib/inventory";
import { decimalText, startRunPayload } from "@/lib/production";
import FormAlert from "@/components/ui/FormAlert";

/**
 * Starts a run: the ingredients leave the shelf now.
 *
 * Each line starts at what the recipe calls for. Changing one records what
 * really went in — the end of yesterday's bag rather than the plan — which is
 * the only way a usage variance can ever show. A line short of stock is
 * flagged before sending, because the server refuses to issue stock that is
 * not there.
 */
export default function StartRunForm({ run, materials, units }) {
  const router = useRouter();
  const [entered, setEntered] = useState(() => Object.fromEntries(materials.map((line) => [line.itemId, decimalText(line.plannedQuantity)])));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const short = materials.filter((line) => {
    const parsed = parseQuantity(entered[line.itemId], { allowZero: true });
    return !parsed.error && parsed.value > Number(line.onHand);
  });

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const { body, errors: local } = startRunPayload(materials, entered);
    setErrors(local);
    if (Object.keys(local).length) return setFormError(local.form ?? "Some lines need attention.");
    if (short.length) {
      return setFormError(`Not enough ${short.map((line) => line.name).join(", ")} at ${run.location.name}. Move stock here or lower the amount first.`);
    }
    if (!window.confirm("Start this batch? The ingredients are taken out of stock now.")) return;
    setPending(true);
    setFormError(null);
    try {
      await api.post(`/admin/production-orders/${run.id}/start`, body);
      toast.success(`${run.productionNumber} started.`);
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be started.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <FormAlert>{formError}</FormAlert>
      <ul className="flex flex-col gap-2">
        {materials.map((line) => {
          const unit = units[line.itemId];
          const typed = parseQuantity(entered[line.itemId], { allowZero: true });
          const isShort = !typed.error && typed.value > Number(line.onHand);
          return (
            <li key={line.itemId} className="grid gap-2 rounded-field bg-surface-container-low p-3 sm:grid-cols-[2fr_1fr] sm:items-center">
              <p className="text-body-md">
                <span className="block text-label-bold text-on-surface">{line.name}</span>
                <span className="text-on-surface-variant">
                  Recipe says {formatQuantity(line.plannedQuantity, { precision: unit?.precision ?? 3, unit: unit?.code })} ·{" "}
                  <span className={isShort ? "text-label-bold text-error" : ""}>{formatQuantity(line.onHand, { precision: unit?.precision ?? 3, unit: unit?.code })} here</span>
                </span>
              </p>
              <div className="flex flex-col gap-1">
                <label htmlFor={`issue-${line.itemId}`} className="text-label-bold text-on-surface">Take out{unit ? ` (${unit.code})` : ""}</label>
                <input
                  id={`issue-${line.itemId}`}
                  inputMode="decimal"
                  value={entered[line.itemId]}
                  onChange={(event) => setEntered((current) => ({ ...current, [line.itemId]: event.target.value }))}
                  aria-invalid={errors[line.itemId] || isShort ? "true" : undefined}
                  className={`w-full rounded-field bg-surface-container-lowest px-3 py-2.5 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring ${errors[line.itemId] || isShort ? "border border-error" : "border border-transparent"}`}
                />
                {errors[line.itemId] ? <p className="text-label-bold text-error">{errors[line.itemId]}</p> : isShort ? <p className="text-label-bold text-error">More than is here.</p> : null}
              </div>
            </li>
          );
        })}
      </ul>
      <button type="submit" disabled={pending} className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {pending ? "Starting…" : "Start — take the ingredients out"}
      </button>
    </form>
  );
}
