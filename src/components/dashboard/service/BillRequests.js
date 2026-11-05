import Link from "next/link";
import { Receipt } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { ORDER_TYPE_LABELS, waitingFor } from "@/lib/service";

/**
 * Tables that have asked to settle.
 *
 * The other half of a waiter who cannot take money. Asking for the bill is a
 * fact about the room, not a change to the order — nothing moves, nothing is
 * owed differently, the kitchen is unaffected — so it is not a status; it is a
 * queue in front of whoever is on the till.
 *
 * Oldest first, and the wait said out loud, because that is the whole content
 * of the signal: a table that asked eight minutes ago is a table scanning the
 * room for somebody to catch the eye of, and a list sorted any other way
 * leaves them doing it.
 *
 * Rendered on the till's overview and on the pass. Deliberately not a page of
 * its own: nobody goes looking for a screen about a thing they do not know has
 * happened.
 */
export default function BillRequests({ tickets = [], names = {}, currency = "PKR", canSettle = false }) {
  if (!tickets.length) return null;

  return (
    <section className="flex flex-col gap-4 rounded-card bg-secondary-container p-5 text-on-secondary-container">
      <div className="flex items-start gap-3">
        <Receipt aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <div>
          <h2 className="text-label-bold">
            {tickets.length} {tickets.length === 1 ? "table is" : "tables are"} asking for the bill
          </h2>
          <p className="mt-1 text-body-md">
            {canSettle
              ? "Open the order to take the money. It comes off this list the moment it is paid."
              : "Somebody on the till needs to settle these."}
          </p>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {tickets.map((ticket) => {
          // The same wait label the order page uses, rather than arithmetic of
          // its own — and reading the clock through it keeps this component a
          // pure function of its props.
          const wait = waitingFor(ticket.billRequestedAt);

          return (
            <li
              key={ticket.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-lowest px-4 py-3 text-on-surface"
            >
              <span className="min-w-0">
                <span className="text-label-bold">
                  {ticket.table?.name ? `Table ${ticket.table.name}` : (ORDER_TYPE_LABELS[ticket.type] ?? ticket.type)}
                </span>
                <span className="block text-label-bold font-normal text-on-surface-variant">
                  <span className="font-mono">{ticket.orderNumber}</span>
                  {" · "}
                  {formatMoney(ticket.grandTotal, ticket.currency ?? currency)}
                  {" · waiting "}
                  {wait.label}
                  {names[ticket.billRequestedById] ? ` · asked by ${names[ticket.billRequestedById]}` : ""}
                </span>
              </span>

              <Link
                href={`/dashboard/orders/${ticket.id}`}
                className="shrink-0 rounded-field bg-primary-container px-4 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {canSettle ? "Take the money" : "Open it"}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
