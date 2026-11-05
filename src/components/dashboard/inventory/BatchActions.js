"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { RowButton } from "@/components/dashboard/menus/controls";

/**
 * Hold a delivery back, release it, or throw it away.
 *
 * Holding back is not a loss — a suspect delivery may be fine — so it stays in
 * stock and in the valuation; it is simply not used first. Writing off is the
 * loss, and goes on the wastage record with its cost.
 */
export default function BatchActions({ batch, canQuarantine, canWriteOff }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const expired = batch.status === "EXPIRED" || batch.isExpired;

  async function run(action, success) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      router.refresh();
    } catch (failure) {
      toast.error(failure?.message ?? "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-wrap gap-1">
      {canQuarantine && !expired ? (
        batch.status === "QUARANTINED" ? (
          <RowButton disabled={busy} onClick={() => run(() => api.put(`/admin/stock-batches/${batch.id}/status`, { status: "ACTIVE" }), `Batch ${batch.batchNumber} released.`)}>
            Release
          </RowButton>
        ) : (
          <RowButton disabled={busy} onClick={() => run(() => api.put(`/admin/stock-batches/${batch.id}/status`, { status: "QUARANTINED" }), `Batch ${batch.batchNumber} held back.`)}>
            Hold back
          </RowButton>
        )
      ) : null}
      {canWriteOff ? (
        <RowButton
          tone="danger"
          disabled={busy}
          onClick={() => {
            if (!window.confirm(`Write off what is left of batch ${batch.batchNumber}? It comes out of stock and is recorded as wastage.`)) return;
            run(() => api.post(`/admin/stock-batches/${batch.id}/write-off`, { reason: expired ? "EXPIRED" : "SPOILED" }), `Batch ${batch.batchNumber} written off.`);
          }}
        >
          Write off
        </RowButton>
      ) : null}
    </span>
  );
}
