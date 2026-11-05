"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import FormAlert from "@/components/ui/FormAlert";
import { MANUAL_MOVEMENTS, MOVEMENT_TYPES, cashVariance } from "@/lib/finance";

/**
 * Closing a till, and moving cash in and out of it during a shift.
 *
 * The one deliberate decision here: **the expected figure is not shown until
 * the cashier has typed what they counted.** If the screen says "expected
 * 14,350" next to an empty box, that is the number that gets typed — not
 * maliciously, but because counting cash is boring and the screen looks
 * confident. Hiding it until a count exists is the difference between a
 * reconciliation and a formality.
 *
 * Once a figure is entered, the difference appears immediately and is named
 * "over" or "short" rather than shown as a signed variance. They are different
 * problems: short is usually a missing payment or a theft, over is usually a
 * sale that was never rung up.
 */
export default function CloseDrawer({ session, expected, currency, canClose, canReconcile, canRecordMovement }) {
  const router = useRouter();
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [movement, setMovement] = useState({ open: false, type: "PAY_OUT", amount: "", reason: "" });

  const typed = counted.trim() !== "" && Number.isFinite(Number(counted));
  const variance = typed ? cashVariance({ expected, counted }) : null;

  async function close(event) {
    event.preventDefault();
    if (busy || !typed) return;

    const warning =
      variance && variance.direction !== "square"
        ? `The drawer is ${variance.label.toLowerCase()} by ${formatMoney(variance.amount, currency)}. Close it anyway?`
        : "Close this session?";
    if (!window.confirm(warning)) return;

    setBusy("close");
    setError(null);
    try {
      await api.post(`/admin/registers/${session.id}/close`, {
        countedCash: Number(counted),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      toast.success("Drawer closed.");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  async function record(event) {
    event.preventDefault();
    if (busy) return;

    const value = Number(movement.amount);
    if (!Number.isFinite(value) || value === 0) {
      setError("Enter how much moved.");
      return;
    }

    // Always sent positive. The server decides the sign from the type and
    // refuses a negative outright — it will not take the typist's word for
    // which way the money went, because a pay-out sent as a positive number
    // would inflate the drawer and hide a shortfall.

    setBusy("movement");
    setError(null);
    try {
      await api.post(`/admin/registers/${session.id}/movements`, {
        type: movement.type,
        amount: Math.abs(value),
        ...(movement.reason.trim() ? { reason: movement.reason.trim() } : {}),
      });
      toast.success("Recorded.");
      setMovement({ open: false, type: "PAY_OUT", amount: "", reason: "" });
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  async function reconcile() {
    if (busy) return;
    if (!window.confirm("Sign this session off? The variance is accepted as final and posts to the ledger.")) return;

    setBusy("reconcile");
    setError(null);
    try {
      await api.post(`/admin/registers/${session.id}/reconcile`, {});
      toast.success("Reconciled.");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <FormAlert>{error}</FormAlert>

      {session.status === "OPEN" && canRecordMovement ? (
        movement.open ? (
          <form onSubmit={record} className="flex flex-col gap-3 rounded-field bg-surface-container-low p-4">
            <p className="text-label-bold text-on-surface">Money in or out mid-shift</p>
            <SelectField
              id="movement-type"
              label="What happened"
              value={movement.type}
              onChange={(event) => setMovement((state) => ({ ...state, type: event.target.value }))}
              options={MANUAL_MOVEMENTS.map((key) => ({ value: key, label: MOVEMENT_TYPES[key].label }))}
            />
            <Field
              id="movement-amount"
              label="How much"
              type="number"
              step="0.01"
              min="0"
              value={movement.amount}
              onChange={(event) => setMovement((state) => ({ ...state, amount: event.target.value }))}
              hint="A positive figure. Whether it adds or subtracts comes from what happened, above."
              autoComplete="off"
              required
            />
            <Field
              id="movement-reason"
              label="Why"
              value={movement.reason}
              onChange={(event) => setMovement((state) => ({ ...state, reason: event.target.value }))}
              autoComplete="off"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={Boolean(busy)}
                className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {busy === "movement" ? "Recording…" : "Record it"}
              </button>
              <button
                type="button"
                onClick={() => setMovement({ open: false, type: "PAY_OUT", amount: "", reason: "" })}
                className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest"
              >
                Not now
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setMovement((state) => ({ ...state, open: true }))}
            className="w-fit rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Record cash in or out
          </button>
        )
      ) : null}

      {session.status === "OPEN" && canClose ? (
        <form onSubmit={close} className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
          <div>
            <h2 className="font-display text-headline-md text-on-surface">Count the drawer</h2>
            <p className="mt-1 text-body-md text-on-surface-variant">
              Count the cash first and type what is actually there. The figure the system expects appears once you
              have — reading it beforehand is how a count becomes a formality.
            </p>
          </div>

          <Field
            id="counted-cash"
            label="Counted"
            type="number"
            step="0.01"
            min="0"
            value={counted}
            onChange={(event) => setCounted(event.target.value)}
            autoComplete="off"
            required
          />

          {variance ? (
            <div className="flex flex-col gap-1 rounded-field bg-surface-container-low px-4 py-3">
              <p className="flex flex-wrap items-baseline justify-between gap-2 text-body-md text-on-surface-variant">
                <span>System expected</span>
                <span className="tabular-nums text-on-surface">{formatMoney(expected, currency)}</span>
              </p>
              <p className="flex flex-wrap items-baseline justify-between gap-2 text-body-md text-on-surface-variant">
                <span>You counted</span>
                <span className="tabular-nums text-on-surface">{formatMoney(counted, currency)}</span>
              </p>
              <p className={`flex flex-wrap items-baseline justify-between gap-2 text-label-bold ${variance.tone}`}>
                <span>{variance.label}</span>
                {variance.direction === "square" ? null : (
                  <span className="tabular-nums">{formatMoney(variance.amount, currency)}</span>
                )}
              </p>
              {variance.direction === "short" ? (
                <p className="mt-1 text-body-md text-on-surface-variant">
                  Short usually means a payment was taken and never recorded, or money has gone. Worth finding before
                  the shift leaves.
                </p>
              ) : null}
              {variance.direction === "over" ? (
                <p className="mt-1 text-body-md text-on-surface-variant">
                  Over usually means a sale was never rung up, which is a missing order rather than a windfall.
                </p>
              ) : null}
            </div>
          ) : null}

          <TextAreaField
            id="close-notes"
            label="Notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
            hint="Anything that explains the count."
          />

          <button
            type="submit"
            disabled={Boolean(busy) || !typed}
            className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {busy === "close" ? "Closing…" : "Close the drawer"}
          </button>
        </form>
      ) : null}

      {session.status === "CLOSED" && canReconcile ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={reconcile}
            className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {busy === "reconcile" ? "Signing off…" : "Sign this session off"}
          </button>
          <p className="text-body-md text-on-surface-variant">
            Accepts the count as final. Any over or short is posted to the ledger as cash over/short, which is what
            makes it show up in the accounts rather than only here.
          </p>
        </div>
      ) : null}
    </div>
  );
}
