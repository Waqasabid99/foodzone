"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { api } from "@/lib/api-client";

/**
 * The credential a terminal authenticates with.
 *
 * Shown once and stored hashed, exactly like a person's temporary password: a
 * key readable from an admin screen is a key that ends up in somebody's notes,
 * and this one can post attendance for every employee at the branch.
 *
 * Rotating invalidates the old key immediately, so the terminal stops syncing
 * until somebody types the new one into it. That is the right order — a box
 * that has quietly kept working on a leaked key is worse.
 */
export function DeviceKeyPanel({ apiKey, serialNumber, onDone = null }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-card bg-warning-container p-5 text-on-warning-container">
      <p className="text-label-bold">Put this into the terminal now — it is not shown again.</p>
      <p className="select-all break-all font-mono text-body-md" aria-label="Device API key">{apiKey}</p>
      <p className="text-body-md">
        The terminal authenticates with this key <em>and</em> its serial, {serialNumber} — a key alone is not enough.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={copy}
          className="rounded-field bg-surface-container-lowest px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        {onDone ? (
          <button type="button" onClick={onDone} className="text-label-bold underline">Done</button>
        ) : null}
      </div>
    </div>
  );
}

/** Issues a replacement key for a terminal already registered. */
export default function RotateDeviceKey({ device }) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  async function rotate() {
    if (pending) return;
    if (
      !window.confirm(
        `Issue a new key for ${device.name}? The old one stops working straight away, so the terminal will not sync until somebody types the new key into it.`,
      )
    ) {
      return;
    }

    setPending(true);
    setError(null);
    try {
      const result = await api.post(`/admin/attendance-devices/${device.id}/rotate-key`, {});
      setApiKey(result.apiKey);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "A new key could not be issued.");
    } finally {
      setPending(false);
    }
  }

  if (apiKey) {
    return <DeviceKeyPanel apiKey={apiKey} serialNumber={device.serialNumber} onDone={() => setApiKey(null)} />;
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={rotate}
        disabled={pending}
        className="inline-flex w-fit items-center gap-2 rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <KeyRound aria-hidden="true" className="size-4" />
        {pending ? "Issuing…" : "Issue a new key"}
      </button>
      {error ? <p className="text-label-bold text-error">{error}</p> : null}
      <p className="text-body-md text-on-surface-variant">
        Do this if the key has been shared, or if the terminal is replaced. Punches already collected are unaffected.
      </p>
    </div>
  );
}
