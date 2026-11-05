"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Receipt } from "lucide-react";
import { api } from "@/lib/api-client";

/**
 * What a waiter does instead of taking the money.
 *
 * The person carrying plates is not the person the cash is counted against,
 * so a waiter asked for the bill puts the table in front of whoever is on the
 * till rather than opening a payment form they have no business opening.
 *
 * Nothing about the order changes — not its status, not its total, not what
 * the kitchen sees. The only new fact is that somebody is sitting there
 * waiting, and the button says so plainly rather than implying the money has
 * moved.
 *
 * Idempotent at the server, so a waiter who walks past the table twice and
 * taps twice does not push it back down the till's queue.
 */
export default function AskForTheBill({ order, canAsk = false, canClear = false }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const asked = Boolean(order.billRequestedAt);
  if (!asked && !canAsk) return null;

  async function ask() {
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/admin/orders/${order.id}/bill-request`);
      toast.success("The till has it.");
      router.refresh();
    } catch (failure) {
      toast.error(failure?.message ?? "That did not reach the till.");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (busy) return;
    setBusy(true);
    try {
      await api.delete(`/admin/orders/${order.id}/bill-request`);
      toast.success("Taken off the till's list.");
      router.refresh();
    } catch (failure) {
      toast.error(failure?.message ?? "It could not be cleared.");
    } finally {
      setBusy(false);
    }
  }

  if (asked) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-secondary-container px-5 py-4 text-on-secondary-container">
        <p className="flex items-center gap-3 text-body-md">
          <Receipt aria-hidden="true" className="size-5 shrink-0" />
          <span>
            <strong className="text-label-bold">This table is waiting to pay.</strong> It is on the till&rsquo;s list and
            comes off the moment the money is taken.
          </span>
        </p>
        {canClear ? (
          <button
            type="button"
            onClick={clear}
            disabled={busy}
            className="shrink-0 rounded-field bg-surface-container-lowest px-4 py-2.5 text-label-bold text-on-surface disabled:opacity-60 hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {busy ? "Clearing…" : "Asked by mistake"}
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <button
      type="button"
      onClick={ask}
      disabled={busy}
      className="inline-flex w-fit items-center gap-2 rounded-field bg-secondary-container px-5 py-3 text-label-bold text-on-secondary-container disabled:opacity-60 hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Receipt aria-hidden="true" className="size-4" />
      {busy ? "Telling the till…" : "They want the bill"}
    </button>
  );
}
