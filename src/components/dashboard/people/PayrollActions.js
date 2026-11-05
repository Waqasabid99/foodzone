"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Moving a pay run through its stages.
 *
 * The three are deliberately separate, and the wording says so, because each
 * commits something different:
 *
 *   * **Generate** is a calculation. Re-runnable while the run is a draft, so a
 *     corrected attendance day flows straight through.
 *   * **Approve** is the commitment. It posts the wage bill to the ledger and
 *     freezes the attendance the payslips were built from — otherwise a later
 *     re-derivation changes the attendance a payslip claims to rest on, and the
 *     two disagree with no way to tell which is right.
 *   * **Mark paid** records that money actually left, and clears the payable.
 */
export default function PayrollActions({ period, currency, canProcess, canApprove, canMarkPaid }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState(today());

  const status = period.status;
  const empty = period.payslipCount === 0;

  async function run(action, body, { confirm, success }) {
    if (busy) return;
    if (confirm && !window.confirm(confirm)) return;

    setBusy(action);
    setError(null);
    try {
      await api.post(`/admin/payroll-periods/${period.id}/${action}`, body ?? {});
      toast.success(success);
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

      {canProcess && ["DRAFT", "PROCESSING"].includes(status) ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() =>
              run("generate", {}, {
                confirm: empty ? null : "Rebuild the payslips in this run? Drafts are replaced with fresh figures.",
                success: "Payslips generated.",
              })
            }
            disabled={Boolean(busy)}
            className="w-fit rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {busy === "generate" ? "Generating…" : empty ? "Generate payslips" : "Regenerate payslips"}
          </button>
          <p className="text-body-md text-on-surface-variant">
            Built from <strong>approved attendance only</strong>. Anything still waiting on a signature is not paid, so
            sign attendance off first.
          </p>
        </div>
      ) : null}

      {canApprove && ["DRAFT", "PROCESSING"].includes(status) && !empty ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() =>
              run("approve", {}, {
                confirm: `Approve ${period.name}? ${formatMoney(period.totalGross, currency)} goes to the ledger and the attendance behind it is frozen.`,
                success: "Payroll approved and posted.",
              })
            }
            disabled={Boolean(busy)}
            className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {busy === "approve" ? "Approving…" : "Approve this run"}
          </button>
          <p className="text-body-md text-on-surface-variant">
            The wage is a cost of the month it was earned, so it posts now rather than when it is paid.
          </p>
        </div>
      ) : null}

      {canMarkPaid && status === "APPROVED" ? (
        <div className="flex flex-col gap-3 rounded-field bg-surface-container-low p-4">
          <p className="text-label-bold text-on-surface">Record the payment</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="paid-at" label="Paid on" type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} />
            <Field id="paid-ref" label="Reference" value={reference} onChange={(event) => setReference(event.target.value)} hint="The bank transfer or batch number." autoComplete="off" />
          </div>
          <button
            type="button"
            onClick={() =>
              run("mark-paid", { paidAt, reference: reference.trim() || null }, {
                confirm: `Record ${formatMoney(period.totalNet, currency)} as paid? This cannot be cancelled afterwards.`,
                success: "Recorded as paid.",
              })
            }
            disabled={Boolean(busy)}
            className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {busy === "mark-paid" ? "Recording…" : "Mark as paid"}
          </button>
        </div>
      ) : null}

      {canApprove && ["DRAFT", "PROCESSING", "APPROVED"].includes(status) ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() =>
              run("cancel", { reason: null }, {
                confirm:
                  status === "APPROVED"
                    ? `Cancel ${period.name}? The ledger entry is reversed and the attendance it froze is free again.`
                    : `Cancel ${period.name}?`,
                success: "Run cancelled.",
              })
            }
            disabled={Boolean(busy)}
            className="w-fit rounded-field border border-error px-5 py-2.5 text-label-bold text-error hover:bg-error-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {busy === "cancel" ? "Cancelling…" : "Cancel this run"}
          </button>
          <p className="text-body-md text-on-surface-variant">
            Once the money has gone out, a run cannot be cancelled — the payment is a fact, and unwinding it is a
            separate correction.
          </p>
        </div>
      ) : null}
    </div>
  );
}
