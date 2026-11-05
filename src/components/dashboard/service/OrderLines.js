"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "react-toastify";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { ITEM_STATES } from "@/lib/service";

/**
 * What was ordered, round by round.
 *
 * A dine-in bill is not one list: it is a meal, and a table that ordered
 * starters, then mains, then coffee has three rounds on one bill. Showing
 * them as a flat list loses the thing a waiter is usually looking for, which
 * is what the last round was and whether it has arrived.
 *
 * A line can be taken off only while the kitchen has not started it. Past
 * that the food exists and somebody has to pay for it or write it off, so
 * there is no button — the server refuses too, and this is the half that
 * stops a waiter reaching for something that will fail.
 */
export default function OrderLines({ order, currency = "PKR", canEdit = false, canAdd = false }) {
  const router = useRouter();
  const [busy, setBusy] = useState(() => new Set());

  const lines = order.items ?? [];
  const rounds = new Map();
  for (const line of lines) {
    const course = line.course ?? 1;
    if (!rounds.has(course)) rounds.set(course, []);
    rounds.get(course).push(line);
  }
  const courses = [...rounds.entries()].sort(([a], [b]) => a - b);

  async function remove(line) {
    if (busy.has(line.id)) return;
    if (!window.confirm(`Take "${line.nameSnapshot}" off this bill?`)) return;

    setBusy((current) => new Set(current).add(line.id));
    try {
      await api.delete(`/admin/orders/${order.id}/items/${line.id}`);
      toast.success("Off the bill.");
      router.refresh();
    } catch (failure) {
      toast.error(failure?.message ?? "That line could not be removed.");
    } finally {
      setBusy((current) => {
        const copy = new Set(current);
        copy.delete(line.id);
        return copy;
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
        <table className="w-full min-w-md border-collapse text-left text-body-md">
          <caption className="sr-only">Order lines</caption>
          <thead>
            <tr className="border-b border-outline-variant text-label-bold text-on-surface-variant">
              <th scope="col" className="py-2 pr-4 font-normal">Item</th>
              <th scope="col" className="py-2 pr-4 text-right font-normal">Qty</th>
              <th scope="col" className="py-2 text-right font-normal">Line</th>
              {canEdit ? <th scope="col" className="py-2 pl-4"><span className="sr-only">Remove</span></th> : null}
            </tr>
          </thead>
          {courses.map(([course, items]) => (
            <tbody key={course}>
              {/* Only named once there is more than one. A single-round order
                  is just an order, and labelling it "Round 1" would be the
                  screen explaining a distinction nobody made. */}
              {courses.length > 1 ? (
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={canEdit ? 4 : 3}
                    className="pb-1 pt-4 text-left text-label-bold font-normal text-on-surface-variant"
                  >
                    {course === 1 ? "Ordered first" : `Round ${course}`}
                  </th>
                </tr>
              ) : null}

              {items.map((line) => {
                const state = ITEM_STATES[line.status] ?? null;
                const removable = canEdit && line.status === "QUEUED";

                return (
                  <tr key={line.id} className="border-b border-outline-variant align-top">
                    <th scope="row" className="py-3 pr-4 text-left font-normal text-on-surface">
                      {line.nameSnapshot}
                      {line.modifiers?.length ? (
                        <span className="block text-label-bold font-normal text-on-surface-variant">
                          {line.modifiers.map((mod) => mod.nameSnapshot).join(", ")}
                        </span>
                      ) : null}
                      {/* A combo's choices arrive nested as `includes` — the
                          shape `nestComboLines` builds, which is what every
                          other reader of an order uses. */}
                      {line.includes?.length ? (
                        <span className="block text-label-bold font-normal text-on-surface-variant">
                          {line.includes.map((child) => `${child.quantity}× ${child.nameSnapshot}`).join(", ")}
                        </span>
                      ) : null}
                      {line.notes ? <span className="block text-label-bold font-normal text-error">{line.notes}</span> : null}
                      {/* Where the kitchen has got to with it — the answer to
                          "has the second round gone in yet", which is the
                          question a table actually asks. */}
                      {state ? (
                        <span className={`mt-1 inline-block rounded-full px-2.5 py-1 text-label-bold ${state.tone}`}>
                          {state.label}
                        </span>
                      ) : null}
                    </th>
                    <td className="py-3 pr-4 text-right tabular-nums text-on-surface">{line.quantity}</td>
                    <td className="py-3 text-right tabular-nums text-on-surface">
                      {formatMoney(line.lineTotal ?? line.totalPrice, currency)}
                    </td>
                    {canEdit ? (
                      <td className="py-3 pl-4 text-right">
                        {removable ? (
                          <button
                            type="button"
                            onClick={() => remove(line)}
                            disabled={busy.has(line.id)}
                            aria-label={`Take ${line.nameSnapshot} off the bill`}
                            className="rounded-field p-2 text-on-surface-variant disabled:opacity-60 hover:bg-surface-container hover:text-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          >
                            <Trash2 aria-hidden="true" className="size-4" />
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>

      {canAdd ? (
        <Link
          href={`/dashboard/orders/new?addTo=${order.id}`}
          className="inline-flex w-fit items-center gap-2 rounded-field bg-primary-container px-5 py-3 text-label-bold text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Plus aria-hidden="true" className="size-4" />
          Add a round
        </Link>
      ) : null}
    </div>
  );
}
