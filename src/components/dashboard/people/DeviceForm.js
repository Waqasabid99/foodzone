"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { devicePayload } from "@/lib/hr";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { DeviceKeyPanel } from "@/components/dashboard/people/DeviceKey";

/**
 * Registering an attendance terminal, and editing one already registered.
 *
 * The serial cannot change: it is what the box identifies itself as, and it is
 * half of the credential — the key alone will not authenticate, so a caller
 * probing keys also has to know which device it is claiming to be.
 *
 * The branch cannot change either. Every punch the terminal has sent is placed
 * by it, and moving the device would move that history to an outlet it never
 * hung in.
 */
export default function DeviceForm({ device = null, branches }) {
  const router = useRouter();
  const editing = Boolean(device);
  const [issued, setIssued] = useState(null);

  const [form, setForm] = useState({
    name: device?.name ?? "",
    branchId: device?.branchId ?? (branches.length === 1 ? branches[0].id : ""),
    serialNumber: device?.serialNumber ?? "",
    vendor: device?.vendor ?? "",
    model: device?.model ?? "",
    ipAddress: device?.ipAddress ?? "",
    timezone: device?.timezone ?? "",
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    const { body, errors: local } = devicePayload(form, { mode: editing ? "edit" : "create" });
    setErrors(local);
    if (Object.keys(local).length) return setFormError("Some fields need attention.");

    setPending(true);
    setFormError(null);
    try {
      if (editing) {
        await api.patch(`/admin/attendance-devices/${device.id}`, body);
        toast.success("Saved.");
        router.refresh();
      } else {
        const created = await api.post("/admin/attendance-devices", body);
        // Held on screen rather than navigating away: the key is shown once,
        // and a redirect would take it with it.
        setIssued({ apiKey: created.apiKey, id: created.id, serialNumber: created.serialNumber });
        router.refresh();
      }
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be saved.");
    } finally {
      setPending(false);
    }
  }

  if (issued) {
    return (
      <div className="flex flex-col gap-4">
        <DeviceKeyPanel apiKey={issued.apiKey} serialNumber={issued.serialNumber} />
        <button
          type="button"
          onClick={() => router.push(`/dashboard/devices/${issued.id}`)}
          className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          I have saved the key
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <FormAlert>{formError}</FormAlert>

      <Section title="The terminal">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="dev-name" label="Name" value={form.name} onChange={(event) => set({ name: event.target.value })} error={errors.name} placeholder="Back door" hint="Name it after where it hangs." autoComplete="off" />
          {editing ? (
            <div>
              <p className="text-label-bold text-on-surface">Serial</p>
              <p className="mt-1 break-all font-mono text-body-md text-on-surface-variant">{device.serialNumber}</p>
              <p className="mt-1 text-body-md text-on-surface-variant">Fixed — it is half of how the box signs in.</p>
            </div>
          ) : (
            <Field id="dev-serial" label="Serial number" value={form.serialNumber} onChange={(event) => set({ serialNumber: event.target.value })} error={errors.serialNumber} hint="Printed on the terminal. It cannot be changed later." autoComplete="off" />
          )}
        </div>

        {editing ? (
          <div>
            <p className="text-label-bold text-on-surface">Branch</p>
            <p className="mt-1 text-body-md text-on-surface-variant">
              {branches.find((branch) => branch.id === device.branchId)?.name ?? "Another branch"} — fixed, because every
              punch it has sent is placed by it.
            </p>
          </div>
        ) : (
          <SelectField
            id="dev-branch"
            label="Branch"
            value={form.branchId}
            onChange={(event) => set({ branchId: event.target.value })}
            options={[{ value: "", label: "Choose a branch" }, ...branches.map((branch) => ({ value: branch.id, label: branch.name }))]}
            error={errors.branchId}
            hint="Where it hangs. This cannot be changed later."
          />
        )}
      </Section>

      <Section title="Details" description="Optional, and only for finding the box again when it stops talking.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="dev-vendor" label="Make" value={form.vendor} onChange={(event) => set({ vendor: event.target.value })} error={errors.vendor} placeholder="ZKTeco" autoComplete="off" />
          <Field id="dev-model" label="Model" value={form.model} onChange={(event) => set({ model: event.target.value })} error={errors.model} autoComplete="off" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="dev-ip" label="Address on the network" value={form.ipAddress} onChange={(event) => set({ ipAddress: event.target.value })} error={errors.ipAddress} placeholder="192.168.1.50" autoComplete="off" />
          <Field id="dev-tz" label="Time zone" value={form.timezone} onChange={(event) => set({ timezone: event.target.value })} error={errors.timezone} placeholder="Asia/Karachi" hint="Left empty, the branch's own is used." autoComplete="off" />
        </div>
      </Section>

      {editing ? null : (
        <p className="rounded-card bg-surface-container-lowest px-5 py-4 text-body-md text-on-surface-variant">
          Registering issues an API key, shown once on the next screen. Have the terminal in front of you.
        </p>
      )}

      <div className="min-w-48 max-w-xs">
        <SubmitButton pending={pending} pendingLabel="Saving…">{editing ? "Save changes" : "Register it"}</SubmitButton>
      </div>
    </form>
  );
}
