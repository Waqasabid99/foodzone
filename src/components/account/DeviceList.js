"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import FormAlert from "@/components/ui/FormAlert";
import { deviceStaleness, platformLabel } from "@/lib/account";
import { dateLabel } from "@/lib/finance";

/**
 * Phones and browsers signed up for push.
 *
 * This is a security screen as much as a convenience one: a device listed
 * here that the person does not recognise is a session they should end. So
 * each row says when it was last used and calls out the ones that have gone
 * quiet, rather than printing a date and leaving the arithmetic to them.
 */
export default function DeviceList({ devices, timeZone = "UTC" }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function remove(id) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await api.delete(`/me/devices/${id}`);
      toast.success("Device removed. It will stop getting notifications.");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setPending(false);
    }
  }

  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      <FormAlert>{error}</FormAlert>
      <ul className="flex flex-col gap-3">
        {devices.map((device) => {
          const stale = deviceStaleness(device, now);
          return (
            <li key={device.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
              <div className="min-w-0 flex-1">
                <p className="text-label-bold text-on-surface">
                  {device.deviceName || platformLabel(device.platform)}
                </p>
                <p className="mt-1 text-body-md text-on-surface-variant">
                  {platformLabel(device.platform)}
                  {device.appVersion ? ` · app ${device.appVersion}` : ""}
                  {device.lastSeenAt ? ` · last used ${dateLabel(device.lastSeenAt, timeZone)}` : ""}
                </p>
                {stale ? <p className="mt-1 text-body-md text-on-surface-variant">{stale}</p> : null}
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(device.id)}
                className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
