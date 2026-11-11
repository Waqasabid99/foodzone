"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { formatQuantity, parseQuantity } from "@/lib/inventory";
import FormAlert from "@/components/ui/FormAlert";

/**
 * Receives a transfer, line by line.
 *
 * Each line starts at what was sent. Anything less is recorded as lost on the
 * way — written off against the branch that sent it — so a short delivery is
 * a named loss rather than two numbers that quietly disagree.
 */
export default function ReceiveTransferForm({ transfer }) {
  const router = useRouter();
  const [received, setReceived] = useState(() => Object.fromEntries(transfer.items.map((line) => [line.id, trim(line.quantitySent)])));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const short = transfer.items.filter((line) => {
    const parsed = parseQuantity(received[line.id], { allowZero: true });
    return !parsed.error && parsed.value < Number(line.quantitySent);
  });

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const problems = {};
    const lines = [];
    for (const line of transfer.items) {
      const parsed = parseQuantity(received[line.id], { allowZero: true });
      if (parsed.error) problems[line.id] = parsed.error;
      else if (parsed.value > Number(line.quantitySent)) problems[line.id] = `Only ${formatQuantity(line.quantitySent, { precision: 6, unit: line.item.uom.code })} was sent.`;
      else lines.push({ transferItemId: line.id, quantityReceived: parsed.value });
    }
    setErrors(problems);
    if (Object.keys(problems).length) return setFormError("Some lines need attention.");
    if (short.length && !window.confirm(`${short.length} ${short.length === 1 ? "line is" : "lines are"} short. The difference will be recorded as lost on the way, against the sending branch. Receive it like this?`)) return;

    setPending(true);
    setFormError(null);
    try {
      await api.post(`/admin/stock-transfers/${transfer.id}/receive`, { lines });
      toast.success(`Transfer ${transfer.transferNumber} received.`);
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be received.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <FormAlert>{formError}</FormAlert>
      <ul className="flex flex-col gap-2">
        {transfer.items.map((line) => (
          <li key={line.id} className="grid gap-2 rounded-field bg-surface-container-low p-3 sm:grid-cols-[2fr_1fr] sm:items-center">
            <p className="text-body-md">
              <span className="block text-label-bold text-on-surface">{line.item.name}</span>
              <span className="text-on-surface-variant">Sent {formatQuantity(line.quantitySent, { precision: 6, unit: line.item.uom.code })}</span>
            </p>
            <div className="flex flex-col gap-1">
              <label htmlFor={`receive-${line.id}`} className="text-label-bold text-on-surface">Arrived ({line.item.uom.code})</label>
              <input
                id={`receive-${line.id}`}
                inputMode="decimal"
                value={received[line.id]}
                onChange={(event) => setReceived((current) => ({ ...current, [line.id]: event.target.value }))}
                aria-invalid={errors[line.id] ? "true" : undefined}
                className={`w-full rounded-field bg-surface-container-lowest px-3 py-2.5 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring ${errors[line.id] ? "border border-error" : "border border-outline"}`}
              />
              {errors[line.id] ? <p className="text-label-bold text-error">{errors[line.id]}</p> : null}
            </div>
          </li>
        ))}
      </ul>
      <button type="submit" disabled={pending} className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {pending ? "Receiving…" : short.length ? "Receive, with a shortfall" : "Receive everything"}
      </button>
    </form>
  );
}

function trim(value) {
  const text = String(value);
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}
