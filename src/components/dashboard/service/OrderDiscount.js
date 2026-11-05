"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";

/**
 * Taking money off by hand.
 *
 * Its own permission, and a reason is required, because this is the one place
 * a member of staff can reduce what a customer pays with nothing but their own
 * judgement. The reason is not paperwork — it is the difference between "the
 * steak was cold" and a pattern of discounts to the same phone number that
 * nobody can see because the field was optional.
 *
 * Either an amount or a percentage, never both: "20% and 200 off" has two
 * readings and the till should not have to pick one.
 */
export default function OrderDiscount({ order, currency, discounts, canApply }) {
  const router = useRouter();
  const [mode, setMode] = useState("percent");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const manual = (discounts ?? []).filter((row) => row.source === "MANUAL" || row.isManual);

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    const local = {};
    const number = Number(String(value).replace(/,/g, ""));
    if (!String(value).trim()) local.value = "How much?";
    else if (!Number.isFinite(number) || number <= 0) local.value = "Enter a number above zero.";
    else if (mode === "percent" && number > 100) local.value = "A percentage cannot be over 100.";
    if (reason.trim().length < 3) local.reason = "Say why — it is the only record of this decision.";
    setErrors(local);
    if (Object.keys(local).length) return;

    setPending(true);
    setError(null);
    try {
      await api.post(`/admin/orders/${order.id}/discounts`, {
        ...(mode === "percent" ? { percent: number } : { amount: number }),
        reason: reason.trim(),
      });
      toast.success("Discount applied.");
      setValue("");
      setReason("");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "It could not be applied.");
    } finally {
      setPending(false);
    }
  }

  async function remove(discountId) {
    if (pending) return;
    if (!window.confirm("Take this discount off the order?")) return;
    setPending(true);
    setError(null);
    try {
      await api.delete(`/admin/orders/${order.id}/discounts/${discountId}`);
      toast.success("Discount removed.");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "It could not be removed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <FormAlert>{error}</FormAlert>

      {manual.length ? (
        <ul className="flex flex-col gap-2">
          {manual.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low px-4 py-3">
              <span className="min-w-0 text-body-md text-on-surface">
                {row.label ?? "Manual discount"}
                {row.reason ? <span className="block text-label-bold font-normal text-on-surface-variant">{row.reason}</span> : null}
              </span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums text-body-md text-on-surface">−{formatMoney(row.amount, currency)}</span>
                {canApply ? (
                  <button
                    type="button"
                    aria-label="Remove this discount"
                    onClick={() => remove(row.id)}
                    disabled={pending}
                    className="rounded-field px-2 py-1.5 text-error hover:bg-surface-container disabled:opacity-60"
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-md text-on-surface-variant">No manual discount on this order.</p>
      )}

      {canApply ? (
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 rounded-field bg-surface-container-low p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id="discount-mode"
              label="Take off"
              value={mode}
              onChange={(event) => setMode(event.target.value)}
              options={[
                { value: "percent", label: "A percentage" },
                { value: "amount", label: "A fixed amount" },
              ]}
            />
            <Field
              id="discount-value"
              label={mode === "percent" ? "Percent" : "Amount"}
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              error={errors.value}
              autoComplete="off"
            />
          </div>
          <Field
            id="discount-reason"
            label="Why"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={errors.reason}
            hint="Goes on the order permanently. “Cold food”, “long wait”, “manager's call”."
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={pending}
            className="w-fit rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {pending ? "Applying…" : "Apply discount"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
