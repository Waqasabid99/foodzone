"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { PAYMENT_METHODS, changeDue, methodLabel, paymentPayload } from "@/lib/service";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";

/** Notes a cashier actually gets handed, so the common case is one tap. */
const QUICK_NOTES = [500, 1000, 5000];

/**
 * Taking money at the counter.
 *
 * Three things this screen does that a generic payment form would not:
 *
 *   * **Cash asks what was handed over, and shows the change.** The cashier is
 *     counting coins out of a drawer while somebody waits, so the subtraction
 *     is done here rather than in their head. It is exact decimal arithmetic,
 *     because a float rounding error in this number is a coin.
 *   * **Cash lands in a drawer.** The open register session is found for them
 *     rather than asked for — cash taken with no session attached is cash
 *     nobody notices is missing at close. If none is open the server opens one
 *     in their name rather than letting the money fall outside every count,
 *     and the form says so first, because a drawer opened from zero needs its
 *     float correcting.
 *   * **It cannot overpay.** The amount defaults to what is outstanding and is
 *     refused above it, because a till is exactly where somebody types 5000
 *     meaning 500.
 *
 * Every request carries an idempotency key. A tap on a flaky connection is
 * otherwise a double charge the customer finds on their statement.
 */
export default function TakePayment({ order, outstanding, register, canCollect }) {
  const router = useRouter();
  const currency = order.currency ?? "PKR";

  const [form, setForm] = useState({ method: "CASH", amount: outstanding, tender: "" });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  // One key per attempt at this amount, regenerated after a success so the
  // next payment on the same order is a new charge rather than a replay.
  const [attempt, setAttempt] = useState(0);
  const idempotencyKey = useMemo(() => `pos-${order.id}-${attempt}`, [order.id, attempt]);

  const takesTender = PAYMENT_METHODS[form.method]?.takesTender;
  const change = takesTender && String(form.tender).trim() ? changeDue(form.tender, form.amount || 0) : null;

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    const { body, errors: local } = paymentPayload(
      { ...form, orderId: order.id, registerSessionId: register?.id, idempotencyKey },
      { outstanding },
    );
    setErrors(local);
    if (Object.keys(local).length) return setFormError("Check the amount before taking the money.");

    setPending(true);
    setFormError(null);
    try {
      const result = await api.post("/admin/payments", body);
      const paymentId = result?.payment?.id ?? result?.id;

      // Cash is only really taken once it is marked collected — that is what
      // puts it into the shift's expected drawer total.
      if (form.method === "CASH" && paymentId && canCollect) {
        await api.post(`/admin/payments/${paymentId}/collect`, register?.id ? { registerSessionId: register.id } : {});
      }

      toast.success(
        change && !change.short && Number(change.change) > 0
          ? `Taken. Change ${formatMoney(change.change, currency)}.`
          : "Payment recorded.",
      );
      setAttempt((n) => n + 1);
      set({ tender: "" });
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "The payment did not go through.");
    } finally {
      setPending(false);
    }
  }

  if (Number(outstanding) <= 0) {
    return (
      <section className="rounded-card bg-success-container px-5 py-4 text-body-md text-on-success-container">
        Settled in full — {formatMoney(order.grandTotal, currency)} paid.
      </section>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
      <div>
        <h2 className="font-display text-headline-md text-on-surface">Take payment</h2>
        <p className="mt-1 text-body-md text-on-surface-variant">
          <strong className="tabular-nums text-on-surface">{formatMoney(outstanding, currency)}</strong> outstanding on{" "}
          {order.orderNumber}.
        </p>
      </div>

      <FormAlert>{formError}</FormAlert>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          id="pay-method"
          label="How are they paying?"
          value={form.method}
          onChange={(event) => set({ method: event.target.value, tender: "" })}
          options={Object.keys(PAYMENT_METHODS).map((value) => ({ value, label: methodLabel(value) }))}
          error={errors.method}
        />
        <Field
          id="pay-amount"
          label="Charge"
          inputMode="decimal"
          value={form.amount}
          onChange={(event) => set({ amount: event.target.value })}
          error={errors.amount}
          hint="Less than the full amount splits the bill."
          autoComplete="off"
        />
      </div>

      {takesTender ? (
        <div className="flex flex-col gap-3 rounded-field bg-surface-container-low p-4">
          <Field
            id="pay-tender"
            label="Handed over"
            inputMode="decimal"
            value={form.tender}
            onChange={(event) => set({ tender: event.target.value })}
            error={errors.tender}
            hint="Optional — only so the change can be worked out."
            autoComplete="off"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => set({ tender: form.amount })}
              className="rounded-field bg-surface-container-high px-3 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest"
            >
              Exact
            </button>
            {QUICK_NOTES.map((note) => (
              <button
                key={note}
                type="button"
                onClick={() => set({ tender: String(note) })}
                className="rounded-field bg-surface-container-high px-3 py-2 text-label-bold tabular-nums text-on-surface hover:bg-surface-container-highest"
              >
                {note}
              </button>
            ))}
          </div>

          {change ? (
            change.short ? (
              <p className="text-body-md text-error">
                {formatMoney(change.shortfall, currency)} short of the amount being charged.
              </p>
            ) : (
              <p className="rounded-field bg-primary-container px-4 py-3 text-on-primary-container">
                Change <strong className="font-display text-headline-md tabular-nums">{formatMoney(change.change, currency)}</strong>
              </p>
            )
          ) : null}
        </div>
      ) : null}

      {form.method === "CASH" ? (
        register ? (
          <p className="text-body-md text-on-surface-variant">
            Going into <strong>{register.registerName ?? "the open drawer"}</strong>, so it counts towards this shift&rsquo;s
            expected cash.
          </p>
        ) : (
          <p className="rounded-field bg-warning-container px-4 py-3 text-body-md text-on-warning-container">
            No drawer is open, so one will be opened in your name when you take this, starting from zero. If you
            counted a float at the start of your shift, open a drawer from Registers first so the count means
            something.
          </p>
        )
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-field bg-primary-container px-6 py-3 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {pending ? "Taking…" : `Take ${formatMoney(form.amount || 0, currency)}`}
      </button>
    </form>
  );
}
