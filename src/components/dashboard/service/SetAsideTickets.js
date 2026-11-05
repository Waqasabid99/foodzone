"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "react-toastify";
import { Hand } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { ORDER_TYPE_LABELS } from "@/lib/order-status";

/**
 * Tickets the kitchen has handed back, waiting on somebody at the till.
 *
 * This is the half that stops "set aside" being a bin. A cook taking a ticket
 * off their board does not end the order — it is still live, still owed, and
 * the customer has not been told anything — so it has to land somewhere a
 * person will see it within the hour, with the reason attached and the two
 * real answers one tap away: send it back, or cancel the sale.
 *
 * On the overview rather than on a page of its own, for the same reason the
 * queue banner is: nobody goes looking for a screen about a thing they do not
 * know has happened.
 */
export default function SetAsideTickets({ tickets = [], names = {}, currency = "PKR", canRecall }) {
  const router = useRouter();
  const [busy, setBusy] = useState(() => new Set());

  if (!tickets.length) return null;

  async function recall(ticket) {
    if (busy.has(ticket.id)) return;
    setBusy((current) => new Set(current).add(ticket.id));
    try {
      await api.delete(`/admin/orders/${ticket.id}/set-aside`);
      toast.success(`${ticket.orderNumber} is back on the kitchen board.`);
      router.refresh();
    } catch (failure) {
      toast.error(failure?.message ?? "It could not be sent back.");
    } finally {
      setBusy((current) => {
        const copy = new Set(current);
        copy.delete(ticket.id);
        return copy;
      });
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-card bg-warning-container p-5 text-on-warning-container">
      <div className="flex items-start gap-3">
        <Hand aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <div>
          <h2 className="text-label-bold">
            The kitchen set {tickets.length} {tickets.length === 1 ? "ticket" : "tickets"} aside
          </h2>
          <p className="mt-1 text-body-md">
            These are off the kitchen&rsquo;s board but still live orders — nobody is cooking them and the customer has
            not been told. Send it back, or cancel it on the order.
          </p>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {tickets.map((ticket) => (
          <li
            key={ticket.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-lowest px-4 py-3 text-on-surface"
          >
            <span className="min-w-0">
              <Link href={`/dashboard/orders/${ticket.id}`} className="font-mono text-label-bold hover:underline">
                {ticket.orderNumber}
              </Link>
              <span className="block text-label-bold font-normal text-on-surface-variant">
                {ORDER_TYPE_LABELS[ticket.type] ?? ticket.type}
                {ticket.table?.name ? ` · table ${ticket.table.name}` : ""}
                {" · "}
                {formatMoney(ticket.grandTotal, ticket.currency ?? currency)}
                {names[ticket.setAsideById] ? ` · by ${names[ticket.setAsideById]}` : ""}
              </span>
              {/* The reason, verbatim. "Walked off" and "duplicate of 0042"
                  are different decisions, which is why it is required. */}
              <span className="block text-body-md text-on-surface">&ldquo;{ticket.setAsideReason}&rdquo;</span>
            </span>

            {canRecall ? (
              <button
                type="button"
                onClick={() => recall(ticket)}
                disabled={busy.has(ticket.id)}
                className="shrink-0 rounded-field bg-primary-container px-4 py-2.5 text-label-bold text-on-primary-container disabled:opacity-60 hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {busy.has(ticket.id) ? "Sending…" : "Send it back"}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
