"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { DELIVERY_STATES, DRIVER_STATES, availability, lastSeen, vehicleLabel, waitingSince } from "@/lib/delivery";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { channel } from "@/lib/realtime";

/** How often the board re-asks. A rush changes faster than a kitchen does. */
const POLL_SECONDS = 8;

/**
 * The dispatch board.
 *
 * Two columns answering the only two questions a dispatcher has during a
 * rush: **what needs a rider**, and **who can take it**. Everything else is a
 * click away on purpose — a board that shows everything shows nothing at
 * 8pm on a Friday.
 *
 * It refreshes itself. A dropped poll keeps the last good board up rather
 * than blanking it, and only says something once it has been out of touch
 * long enough that what is on screen might be wrong. The alternative — an
 * error page where the queue used to be — is worse than slightly stale
 * information, because the jobs are still real either way.
 *
 * Drivers who are full are shown, greyed, with the reason. Filtering them out
 * would leave an empty column that reads as "no drivers" when the truth is
 * "everyone is busy" — and those call for completely different decisions.
 */
export default function DispatchBoard({ branchId, initial, currency, canAssign, liveEnabled = false }) {
  const [board, setBoard] = useState(initial);
  const [lastGood, setLastGood] = useState(() => new Date());
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(null);
  const [picking, setPicking] = useState(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get(`/admin/dispatch?branchId=${encodeURIComponent(branchId)}`);
      if (!mounted.current) return;
      setBoard(data);
      setLastGood(new Date());
      setOffline(false);
    } catch {
      if (mounted.current) setOffline(true);
    }
  }, [branchId]);

  /*
   * Told when a job appears or a driver takes one.
   *
   * Driver *positions* are not on this channel — they are still read from the
   * poll, because nothing pushes them yet: the producer endpoint exists and
   * waits for the mobile app. What arrives live is the part that changes in
   * steps rather than continuously, which is the part a dispatcher is actually
   * waiting on.
   */
  const { live } = useLiveRefresh({
    channels: [channel.branchOrders(branchId)],
    refresh,
    fastSeconds: POLL_SECONDS,
    // Shorter than the other boards': this one also carries driver positions,
    // which no frame announces, so the safety net has to stay closer.
    slowSeconds: 30,
    enabled: liveEnabled,
  });

  useEffect(() => {
    mounted.current = true;
    // A slower tick so the waiting times keep counting up between fetches.
    const clock = setInterval(() => setNow(new Date()), 15_000);
    return () => {
      mounted.current = false;
      clearInterval(clock);
    };
  }, []);

  const secondsStale = Math.floor((now.getTime() - lastGood.getTime()) / 1000);
  const reallyStale = offline && secondsStale > POLL_SECONDS * 4;

  async function offer(deliveryId, driver) {
    if (busy) return;
    const room = availability(driver);
    if (!room.canTake && !window.confirm(`${driver.user?.name ?? "This driver"} is ${String(room.reason).toLowerCase()}. Offer it anyway?`)) return;

    setBusy(deliveryId);
    try {
      await api.post(`/admin/deliveries/${deliveryId}/assign`, { driverId: driver.id, reassign: false });
      toast.success(`Offered to ${driver.user?.name ?? "the driver"}.`);
      setPicking(null);
      await refresh();
    } catch (failure) {
      toast.error(failure?.message ?? "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  const unassigned = board?.unassigned ?? [];
  const inFlight = board?.inFlight ?? [];
  const drivers = board?.drivers ?? [];
  const free = drivers.filter((driver) => availability(driver).canTake).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-md text-on-surface-variant" aria-live="polite">
          {reallyStale
            ? `Out of touch for ${Math.floor(secondsStale / 60) || "<1"} min — this board may be out of date.`
            : `${unassigned.length} waiting · ${inFlight.length} out · ${free} of ${drivers.length} drivers free`}
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
          The board cannot reach the server. It is still trying; the jobs below are the last ones it managed to fetch.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="waiting" className="flex flex-col gap-3">
          <h2 id="waiting" className="font-display text-headline-md text-on-surface">
            Waiting for a rider
          </h2>

          {unassigned.length ? (
            <ul className="flex flex-col gap-2">
              {unassigned.map((delivery) => {
                const wait = waitingSince(delivery.createdAt, { now });
                return (
                  <li key={delivery.id} className="flex flex-col gap-2 rounded-card bg-surface-container-lowest p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link href={`/dashboard/deliveries/${delivery.id}`} className="font-mono text-label-bold text-on-surface hover:underline">
                        {delivery.order?.orderNumber ?? "Order"}
                      </Link>
                      <span className={`text-label-bold ${wait.tone}`}>{wait.label}</span>
                    </div>
                    <p className="text-body-md text-on-surface-variant">
                      {delivery.order?.addressSnapshot?.line1 ?? "No address on the order"}
                      {delivery.order?.addressSnapshot?.city ? `, ${delivery.order.addressSnapshot.city}` : ""}
                    </p>

                    {canAssign ? (
                      picking === delivery.id ? (
                        <div className="flex flex-col gap-1 rounded-field bg-surface-container-low p-2">
                          {drivers.length ? (
                            drivers.map((driver) => {
                              const room = availability(driver);
                              return (
                                <button
                                  key={driver.id}
                                  type="button"
                                  onClick={() => offer(delivery.id, driver)}
                                  disabled={busy === delivery.id}
                                  className={`min-h-11 rounded-field px-3 text-left text-body-md hover:bg-surface-container disabled:opacity-60 ${room.canTake ? "text-on-surface" : "text-on-surface-variant"}`}
                                >
                                  {driver.user?.name ?? "Unnamed"}
                                  <span className="block text-label-bold font-normal text-on-surface-variant">
                                    {room.canTake ? `free — ${room.active} of ${room.max}` : room.reason}
                                  </span>
                                </button>
                              );
                            })
                          ) : (
                            <p className="px-3 py-2 text-body-md text-on-surface-variant">Nobody is on shift.</p>
                          )}
                          <button
                            type="button"
                            onClick={() => setPicking(null)}
                            className="min-h-11 rounded-field px-3 text-left text-label-bold text-on-surface-variant hover:bg-surface-container"
                          >
                            Not now
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPicking(delivery.id)}
                          className="min-h-11 w-fit rounded-field bg-primary-container px-4 text-label-bold text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          Give it to someone
                        </button>
                      )
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-card bg-surface-container-lowest px-5 py-8 text-center text-body-md text-on-surface-variant">
              Nothing waiting. Jobs appear here as orders become ready to leave.
            </p>
          )}
        </section>

        <section aria-labelledby="riders" className="flex flex-col gap-3">
          <h2 id="riders" className="font-display text-headline-md text-on-surface">
            Riders
          </h2>

          {drivers.length ? (
            <ul className="flex flex-col gap-2">
              {drivers.map((driver) => {
                const room = availability(driver);
                const seen = lastSeen(driver.lastLocationAt, { now });
                const state = DRIVER_STATES[driver.status] ?? { label: driver.status, tone: "" };
                return (
                  <li key={driver.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-4">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <Link href={`/dashboard/drivers/${driver.id}`} className="text-label-bold text-on-surface hover:underline">
                          {driver.user?.name ?? "Unnamed driver"}
                        </Link>
                        <span className={`rounded-full px-2.5 py-1 text-label-bold ${state.tone}`}>{state.label}</span>
                      </p>
                      <p className="text-body-md text-on-surface-variant">
                        {vehicleLabel(driver.vehicleType)} · {room.active ?? 0} of {room.max ?? 1} jobs
                      </p>
                      {/* "When we last heard" rather than "where they are": a
                          position twenty minutes old is a guess, and sending
                          somebody to it is how a delivery goes to the wrong
                          street. */}
                      <p className={`text-label-bold font-normal ${seen.tone}`}>Position {seen.label.toLowerCase()}</p>
                    </div>
                    {Number(driver.cashInHand) > 0 ? (
                      <p className="shrink-0 text-right text-body-md text-on-surface">
                        {formatMoney(driver.cashInHand, currency)}
                        <span className="block text-label-bold font-normal text-on-surface-variant">cash held</span>
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-card bg-surface-container-lowest px-5 py-8 text-center text-body-md text-on-surface-variant">
              No riders on shift at this branch.
            </p>
          )}
        </section>
      </div>

      {inFlight.length ? (
        <section aria-labelledby="out" className="flex flex-col gap-3">
          <h2 id="out" className="font-display text-headline-md text-on-surface">
            Out on the road
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {inFlight.map((delivery) => {
              const state = DELIVERY_STATES[delivery.status] ?? { label: delivery.status, tone: "" };
              const wait = waitingSince(delivery.assignedAt ?? delivery.createdAt, { now });
              return (
                <li key={delivery.id} className="flex flex-col gap-1 rounded-card bg-surface-container-lowest p-4">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link href={`/dashboard/deliveries/${delivery.id}`} className="font-mono text-label-bold text-on-surface hover:underline">
                      {delivery.order?.orderNumber ?? "Order"}
                    </Link>
                    <span className={`rounded-full px-2.5 py-1 text-label-bold ${state.tone}`}>{state.label}</span>
                  </p>
                  <p className="text-body-md text-on-surface-variant">
                    {delivery.driver?.user?.name ?? "A driver"} · {wait.label}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
