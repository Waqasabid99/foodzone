"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import FormAlert from "@/components/ui/FormAlert";

/**
 * Turning a posted delivery into a bill.
 *
 * The amounts are already known — from what was accepted, at the prices
 * charged, with the freight that was landed into the stock value — so
 * transcribing them by hand only introduces differences nobody can explain
 * later. The invoice number is asked for because that is the one thing the
 * delivery does not always know.
 */
export default function BillFromReceipt({ receiptId, grnNumber, label = "Bill this delivery" }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function run() {
    if (pending) return;
    const invoice = window.prompt(`What is the supplier's invoice number for ${grnNumber}? (optional)`);
    if (invoice === null) return;

    setPending(true);
    setError(null);
    try {
      const bill = await api.post(
        `/admin/supplier-bills/from-receipt/${receiptId}`,
        invoice.trim() ? { supplierInvoiceNumber: invoice.trim() } : {},
      );
      toast.success(`${bill.billNumber} created from ${grnNumber}.`);
      router.push(`/dashboard/supplier-bills/${bill.id}`);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "It could not be billed.");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="w-fit rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {pending ? "Billing…" : label}
      </button>
      <FormAlert>{error}</FormAlert>
    </div>
  );
}
