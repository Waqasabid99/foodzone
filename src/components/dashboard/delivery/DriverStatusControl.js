"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { DRIVER_STATES } from "@/lib/delivery";
import FormAlert from "@/components/ui/FormAlert";

/**
 * Putting a driver on or off shift from the dispatch desk.
 *
 * Normally the driver does this from their own app — this is for the cases
 * the app cannot cover: a phone that died, somebody who went home without
 * signing off, a rider who has to be stood down.
 *
 * Suspending is separated from going offline because they mean different
 * things to the person: offline is "not working right now", suspended is "not
 * to be given work", and a board that conflates them loses the distinction
 * the moment somebody's shift ends.
 */
export default function DriverStatusControl({ driver, canUpdate }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  if (!canUpdate) return null;

  const options = Object.keys(DRIVER_STATES).filter((status) => status !== driver.status && status !== "ON_DELIVERY");

  async function set(status) {
    if (busy) return;
    if (status === "SUSPENDED" && !window.confirm(`Suspend ${driver.user?.name ?? "this driver"}? They will not be offered any work.`)) return;

    setBusy(status);
    setError(null);
    try {
      await api.put(`/admin/drivers/${driver.id}/status`, { status });
      toast.success(`Now ${DRIVER_STATES[status].label.toLowerCase()}.`);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <FormAlert>{error}</FormAlert>
      <div className="flex flex-wrap gap-2">
        {options.map((status) => (
          <button
            key={status}
            type="button"
            disabled={Boolean(busy)}
            onClick={() => set(status)}
            className={`rounded-field px-4 py-2.5 text-label-bold disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${status === "SUSPENDED" ? "border border-error text-error hover:bg-error-container" : "bg-surface-container-high text-on-surface hover:bg-surface-container-highest"}`}
          >
            {busy === status ? "Working…" : DRIVER_STATES[status].label}
          </button>
        ))}
      </div>
      {driver.status === "ON_DELIVERY" ? (
        <p className="text-body-md text-on-surface-variant">
          They are out on a job. Their status returns on its own when the last delivery is done.
        </p>
      ) : null}
    </div>
  );
}
