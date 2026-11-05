"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { generatePayoutPayload, lastWeek } from "@/lib/delivery";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";

/**
 * Working out what the riders are owed.
 *
 * Opens on last week, because that is what is being paid when somebody comes
 * to this screen. One driver or the whole branch: the second is the ordinary
 * case and the first is for fixing one person's run.
 *
 * Nothing here commits money. A generated payout is a draft — arithmetic
 * somebody still has to agree — and the deliveries in it are not locked until
 * it is approved.
 */
export default function GeneratePayouts({ drivers, branches, currency }) {
  const router = useRouter();
  const period = lastWeek();

  const [form, setForm] = useState({
    mode: "branch",
    driverId: "",
    branchId: branches.length === 1 ? branches[0].id : "",
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    adjustmentAmount: "",
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const holding = drivers.filter((driver) => Number(driver.cashInHand) > 0);

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    const single = form.mode === "driver";
    if (single && !form.driverId) {
      setErrors({ driverId: "Which driver?" });
      return setFormError("Choose a driver.");
    }

    const { body, errors: local } = generatePayoutPayload({
      ...form,
      driverId: single ? form.driverId : null,
      branchId: single ? null : form.branchId || null,
    });
    setErrors(local);
    if (Object.keys(local).length) return setFormError("Check the period.");

    setPending(true);
    setFormError(null);
    try {
      const result = single
        ? await api.post("/admin/driver-payouts", body)
        : await api.post("/admin/driver-payouts/generate", body);
      const count = Array.isArray(result) ? result.length : (result?.created ?? result?.payouts?.length ?? 1);
      toast.success(count === 1 ? "One payout drafted." : `${count} payouts drafted.`);
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "They could not be worked out.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
      <div>
        <h2 className="font-display text-headline-md text-on-surface">Work out a payout</h2>
        <p className="mt-1 text-body-md text-on-surface-variant">
          Earnings and tips for the period, less any cash the driver is still holding. Nothing is committed — what comes
          out is a draft.
        </p>
      </div>

      <FormAlert>{formError}</FormAlert>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => set({ mode: "branch" })}
          aria-pressed={form.mode === "branch"}
          className={`rounded-field px-4 py-2.5 text-label-bold ${form.mode === "branch" ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-low text-on-surface"}`}
        >
          Everyone at a branch
        </button>
        <button
          type="button"
          onClick={() => set({ mode: "driver" })}
          aria-pressed={form.mode === "driver"}
          className={`rounded-field px-4 py-2.5 text-label-bold ${form.mode === "driver" ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-low text-on-surface"}`}
        >
          One driver
        </button>
      </div>

      {form.mode === "driver" ? (
        <SelectField
          id="payout-driver"
          label="Driver"
          value={form.driverId}
          onChange={(event) => set({ driverId: event.target.value })}
          options={[
            { value: "", label: "Choose a driver" },
            ...drivers.map((row) => ({
              value: row.id,
              label: `${row.user?.name ?? "Unnamed"}${Number(row.cashInHand) > 0 ? ` — holding ${formatMoney(row.cashInHand, currency)}` : ""}`,
            })),
          ]}
          error={errors.driverId}
        />
      ) : branches.length > 1 ? (
        <SelectField
          id="payout-branch"
          label="Branch"
          value={form.branchId}
          onChange={(event) => set({ branchId: event.target.value })}
          options={[{ value: "", label: "Every branch you can see" }, ...branches.map((row) => ({ value: row.id, label: row.name }))]}
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="payout-from" label="From" type="date" value={form.periodStart} onChange={(event) => set({ periodStart: event.target.value })} error={errors.periodStart} />
        <Field id="payout-to" label="Until" type="date" value={form.periodEnd} onChange={(event) => set({ periodEnd: event.target.value })} error={errors.periodEnd} />
      </div>

      {form.mode === "driver" ? (
        <Field
          id="payout-adjustment"
          label="Adjustment"
          inputMode="decimal"
          value={form.adjustmentAmount}
          onChange={(event) => set({ adjustmentAmount: event.target.value })}
          error={errors.adjustmentAmount}
          hint="A bonus, or negative for a deduction. Shown as its own line on the payout."
          autoComplete="off"
        />
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {pending ? "Working it out…" : "Work it out"}
      </button>

      {holding.length ? (
        <p className="text-body-md text-on-surface-variant">
          {holding.length === 1 ? "One driver is" : `${holding.length} drivers are`} still holding cash collected on
          delivery. It is deducted from what they are paid, so settle it with them first if they have already handed it
          over.
        </p>
      ) : null}
    </form>
  );
}
