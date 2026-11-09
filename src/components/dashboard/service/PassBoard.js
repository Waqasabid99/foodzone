"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { KITCHEN_POLL_SECONDS, ORDER_TYPE_LABELS, ticketUrgency } from "@/lib/service";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { channel } from "@/lib/realtime";

/**
 * The pass.
 *
 * A waiter's screen, and the exact opposite of the kitchen's. The board
 * answers "what do I make next"; this answers "what is standing under the
 * heat lamp and whose table does it go to". Until this existed, waiters were
 * handed the cook's board for want of anything else — station filters, a
 * "Start it" button for a fryer they do not work, and raw tickets for food
 * nobody can carry anywhere yet.
 *
 * Three things follow from who reads it:
 *
 *   * **The table is the headline, not the order number.** A waiter does not
 *     carry TRQ-2026-10-25-0004 anywhere. They carry it to F-03.
 *   * **The clock counts from when the food came up**, not from when it was
 *     ordered. A plate that has been ready eight minutes is cold, whatever
 *     time the customer sat down, and that is the only number here worth a
 *     colour.
 *   * **One tap takes the whole tray.** Lines go out together, so the button
 *     is on the run and not on each plate — the waiter's hands are full and
 *     the trip is one trip.
 *
 * Grouped per round rather than per order: a starter on the pass and a dessert
 * that has just come up are genuinely two journeys, and merging them would
 * have somebody carry the cold one.
 */
export default function PassBoard({ branchId, initial = [], canHandOver = false, liveEnabled = false }) {
  const [runs, setRuns] = useState(initial);
  const [lastGood, setLastGood] = useState(() => new Date());
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(() => new Set());
  const [now, setNow] = useState(() => new Date());
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get(`/admin/kds/pass?branchId=${encodeURIComponent(branchId)}`);
      if (!mounted.current) return;
      setRuns(Array.isArray(data) ? data : (data?.items ?? []));
      setLastGood(new Date());
      setOffline(false);
    } catch {
      // Silent, like the board: a dropped poll keeps the last good list up and
      // the staleness notice says when to stop trusting it.
      if (mounted.current) setOffline(true);
    }
  }, [branchId]);

  /*
   * Told when a tray is ready, and asking anyway.
   *
   * The poll does not go away — it slows to a minute and a half, and only
   * while the server has confirmed its frames can be trusted. A pass that
   * stopped asking on the strength of a connection would show an empty counter
   * while food went cold on it.
   */
  const { live } = useLiveRefresh({
    channels: [channel.branchKds(branchId)],
    refresh,
    fastSeconds: KITCHEN_POLL_SECONDS,
    enabled: liveEnabled,
  });

  useEffect(() => {
    mounted.current = true;
    // The age badges count up between fetches, whether or not anything fetched.
    const clock = setInterval(() => setNow(new Date()), 15_000);
    return () => {
      mounted.current = false;
      clearInterval(clock);
    };
  }, []);

  const secondsStale = Math.floor((now.getTime() - lastGood.getTime()) / 1000);
  const reallyStale = offline && secondsStale > KITCHEN_POLL_SECONDS * 3;

  /**
   * Takes a whole round out to its table.
   *
   * The same endpoint the kitchen bumps with, narrowed to this round: handing
   * a tray over is doing to a ticket exactly what a cook does when they finish
   * it, and two endpoints for one idea is two things to keep in step.
   */
  async function handOver(run) {
    if (busy.has(run.ticketId)) return;
    setBusy((current) => new Set(current).add(run.ticketId));

    // Optimistic: the run leaves the screen now and comes back if the server
    // refuses. A waiter has already walked away by the time a round trip ends.
    const before = runs;
    setRuns((current) => current.filter((row) => row.ticketId !== run.ticketId));

    try {
      await api.post(`/admin/orders/${run.order.id}/bump`, { status: "SERVED", course: run.course });
      await refresh();
    } catch (failure) {
      setRuns(before);
      toast.error(failure?.message ?? "That did not go through.");
    } finally {
      setBusy((current) => {
        const copy = new Set(current);
        copy.delete(run.ticketId);
        return copy;
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-md text-on-surface-variant" aria-live="polite">
          {reallyStale
            ? `Out of touch for ${Math.floor(secondsStale / 60) || "<1"} min — what is on screen may be out of date.`
            : `${runs.length} ${runs.length === 1 ? "tray" : "trays"} waiting · ${live ? "updating as the kitchen bumps" : `refreshing every ${KITCHEN_POLL_SECONDS}s`}`}
        </p>
        <button
          type="button"
          onClick={refresh}
          className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Refresh now
        </button>
      </div>

      {reallyStale ? (
        <p role="status" className="rounded-card bg-warning-container px-5 py-4 text-body-md text-on-warning-container">
          The pass cannot reach the server. It is still trying, and what is below is the last it managed to fetch.
        </p>
      ) : null}

      {runs.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {runs.map((run) => {
            // Tighter than the kitchen's bands, and deliberately so: ready
            // food goes cold in a way raw food does not, and five minutes on
            // the pass is already a complaint.
            const urgency = ticketUrgency(run.readyAt, { now, warnAfter: 4, lateAfter: 8 });
            const where = run.order.table?.name
              ? `Table ${run.order.table.name}`
              : (ORDER_TYPE_LABELS[run.order.type] ?? run.order.type);

            return (
              <li key={run.ticketId} className={`flex flex-col gap-3 rounded-card border-2 p-4 ${urgency.tone}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  {/* The destination, large. It is what the waiter is actually
                      looking for, and the order number is the reference they
                      need only if something is wrong with it. */}
                  <p className="font-display text-headline-md">{where}</p>
                  <p className="font-display text-headline-md tabular-nums">{urgency.minutes}m</p>
                </div>

                <p className="text-body-md">
                  <Link href={`/dashboard/orders/${run.order.id}`} className="font-mono underline underline-offset-2">
                    {run.order.orderNumber}
                  </Link>
                  {run.order.table?.area ? ` · ${run.order.table.area}` : ""}
                  {run.course > 1 ? ` · round ${run.course}` : ""}
                </p>

                <ul className="flex flex-col gap-2">
                  {run.items.map((item) => (
                    <li key={item.id} className="rounded-field bg-surface-container-lowest px-3 py-2 text-body-md text-on-surface">
                      <strong className="tabular-nums">{item.quantity}×</strong> {item.nameSnapshot}
                      {/* The modifier is what the waiter checks against the
                          plate before picking it up — "no onions" is the whole
                          reason this plate is not interchangeable with the one
                          next to it. */}
                      {item.modifiers?.length ? (
                        <span className="block text-label-bold font-normal text-on-surface-variant">
                          {item.modifiers.map((mod) => mod.nameSnapshot).join(", ")}
                        </span>
                      ) : null}
                      {item.children?.length ? (
                        <span className="block text-label-bold font-normal text-on-surface-variant">
                          {item.children.map((child) => `${child.quantity}× ${child.nameSnapshot}`).join(", ")}
                        </span>
                      ) : null}
                      {item.notes ? <span className="block text-label-bold font-normal text-error">{item.notes}</span> : null}
                    </li>
                  ))}
                </ul>

                {canHandOver ? (
                  <button
                    type="button"
                    onClick={() => handOver(run)}
                    disabled={busy.has(run.ticketId)}
                    className="min-h-11 rounded-field bg-primary-container px-4 text-label-bold text-on-primary-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {busy.has(run.ticketId) ? "Taking it…" : "Taken out"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-card bg-surface-container-lowest px-6 py-14 text-center text-body-md text-on-surface-variant">
          Nothing on the pass. Food appears here the moment the kitchen marks it ready.
        </p>
      )}
    </div>
  );
}
