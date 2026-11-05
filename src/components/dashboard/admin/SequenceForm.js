"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { previewNumber, sequencePayload } from "@/lib/people";

/**
 * The shape of future document numbers: a prefix, and how many digits the
 * counter runs to.
 *
 * The counter itself is not editable here. Moving it back re-issues numbers
 * that are already on invoices and in the ledger; moving it forward leaves a
 * gap an auditor will ask about. Both are worse than living with where it is.
 */
export default function SequenceForm({ sequence, canManage }) {
  const router = useRouter();
  const [form, setForm] = useState({ prefix: sequence.prefix ?? "", padding: String(sequence.padding) });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const unchanged = form.prefix === (sequence.prefix ?? "") && Number(form.padding) === sequence.padding;
  const preview = previewNumber({ prefix: form.prefix, periodKey: sequence.periodKey, value: sequence.nextValue, padding: Number(form.padding) || sequence.padding });

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending || unchanged) return;
    const { body, errors: local } = sequencePayload(form, { nextValue: sequence.nextValue });
    setErrors(local);
    if (Object.keys(local).length) return;
    setPending(true);
    setError(null);
    try {
      await api.patch(`/admin/number-sequences/${sequence.id}`, body);
      toast.success("Numbering saved.");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "It could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`prefix-${sequence.id}`} className="text-label-bold text-on-surface">Prefix</label>
        <input
          id={`prefix-${sequence.id}`}
          value={form.prefix}
          disabled={!canManage}
          onChange={(event) => setForm({ ...form, prefix: event.target.value })}
          aria-invalid={errors.prefix ? "true" : undefined}
          className={`w-full rounded-field bg-surface-container-lowest px-3 py-2.5 text-body-md text-on-surface disabled:opacity-60 focus:outline-2 focus:outline-offset-2 focus:outline-ring ${errors.prefix ? "border border-error" : "border border-transparent"}`}
        />
        {errors.prefix ? <p className="text-label-bold text-error">{errors.prefix}</p> : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`padding-${sequence.id}`} className="text-label-bold text-on-surface">Digits</label>
        <input
          id={`padding-${sequence.id}`}
          inputMode="numeric"
          value={form.padding}
          disabled={!canManage}
          onChange={(event) => setForm({ ...form, padding: event.target.value })}
          aria-invalid={errors.padding ? "true" : undefined}
          className={`w-20 rounded-field bg-surface-container-lowest px-3 py-2.5 text-body-md text-on-surface disabled:opacity-60 focus:outline-2 focus:outline-offset-2 focus:outline-ring ${errors.padding ? "border border-error" : "border border-transparent"}`}
        />
      </div>
      {canManage ? (
        <button type="submit" disabled={pending || unchanged} className="h-11 rounded-field bg-surface-container-high px-5 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {pending ? "Saving…" : "Save"}
        </button>
      ) : null}
      <p className="sm:col-span-3 text-body-md text-on-surface-variant" aria-live="polite">
        Next document: <span className="font-mono text-on-surface">{preview}</span>
        {errors.padding ? <span className="block text-label-bold text-error">{errors.padding}</span> : null}
        {error ? <span className="block text-label-bold text-error">{error}</span> : null}
      </p>
    </form>
  );
}
