"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { availability, lastSeen, vehicleLabel } from "@/lib/delivery";
import FormAlert from "@/components/ui/FormAlert";

/**
 * Giving a job to a driver.
 *
 * Every driver who could take it is listed with the reason they might not —
 * carrying three already, on a break, phone not reporting — rather than being
 * filtered out. A dispatcher under pressure needs to see that the only rider
 * nearby is full, not an empty list that says "no drivers" and leaves them
 * guessing whether the screen is broken.
 *
 * A driver already carrying something can still be offered a job: one more
 * drop on a run they are already making is often the right answer, and the
 * server enforces the real limit.
 */
export default function AssignDriver({ deliveryId, drivers, currency, reassign = false, canAssign }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  async function offer(driver) {
    if (busy) return;
    const room = availability(driver);
    if (!room.canTake && !window.confirm(`${driver.user?.name ?? "This driver"} is ${room.reason.toLowerCase()}. Offer it anyway?`)) return;

    setBusy(driver.id);
    setError(null);
    try {
      await api.post(`/admin/deliveries/${deliveryId}/assign`, { driverId: driver.id, reassign });
      toast.success(`Offered to ${driver.user?.name ?? "the driver"}.`);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  if (!canAssign) return null;

  return (
    <div className="flex flex-col gap-3">
      <FormAlert>{error}</FormAlert>

      {drivers.length ? (
        <ul className="flex flex-col gap-2">
          {drivers.map((driver) => {
            const room = availability(driver);
            const seen = lastSeen(driver.lastLocationAt);
            return (
              <li key={driver.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low px-4 py-3">
                <span className="min-w-0">
                  <span className="text-label-bold text-on-surface">{driver.user?.name ?? "Unnamed driver"}</span>
                  <span className="block text-label-bold font-normal text-on-surface-variant">
                    {vehicleLabel(driver.vehicleType)}
                    {" · "}
                    {room.canTake ? `${room.active} of ${room.max} jobs` : room.reason}
                    {" · "}
                    <span className={seen.tone}>{seen.label}</span>
                    {Number(driver.cashInHand) > 0 ? ` · holding ${formatMoney(driver.cashInHand, currency)}` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => offer(driver)}
                  disabled={busy === driver.id}
                  className={`min-h-11 shrink-0 rounded-field px-4 text-label-bold disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${room.canTake ? "bg-primary-container text-on-primary-container hover:shadow-e2" : "bg-surface-container-high text-on-surface hover:bg-surface-container-highest"}`}
                >
                  {busy === driver.id ? "Offering…" : reassign ? "Move to them" : "Offer"}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-field bg-surface-container-low px-4 py-3 text-body-md text-on-surface-variant">
          Nobody is on shift at this branch. A driver has to be active and either free or already out before they can
          be offered a job.
        </p>
      )}
    </div>
  );
}
