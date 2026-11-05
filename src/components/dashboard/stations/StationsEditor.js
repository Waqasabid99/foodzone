"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { ArrowDown, ArrowUp, CookingPot, Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import { toFormErrors } from "@/lib/form-errors";
import { stationFormValues, stationPayload } from "@/lib/menu-schedule";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";
import { IconButton, RowButton } from "@/components/dashboard/menus/controls";

/**
 * Kitchen stations, each saved on its own.
 *
 * The consequences of each change are spelled out before it happens, because
 * they land in a kitchen, not on this screen: switching a station off sends its
 * tickets to every display, and deleting one unroutes its products.
 */
export default function StationsEditor({ stations, canManage, canOpenProducts }) {
  const router = useRouter();
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function run(action, success) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (success) toast.success(success);
      router.refresh();
    } catch (failure) {
      setMessage(failure?.message ?? "That change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const move = (index, by) =>
    run(() => {
      const next = [...stations];
      [next[index], next[index + by]] = [next[index + by], next[index]];
      return api.post("/admin/kitchen-stations/reorder", { items: next.map((station, position) => ({ id: station.id, sortOrder: position })) });
    });

  const products = (count) => `${count} ${count === 1 ? "product" : "products"}`;

  return (
    <section className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5 sm:p-6">
      <FormAlert>{message}</FormAlert>

      {stations.length ? (
        <ul className="flex flex-col gap-2">
          {stations.map((station, index) =>
            editing === station.id ? (
              <li key={station.id}>
                <StationForm station={station} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={station.id} className={`flex flex-wrap items-center gap-3 rounded-field bg-surface-container-low p-3 ${station.isActive ? "" : "opacity-75"}`}>
                {canManage ? (
                  <div className="flex flex-col">
                    <IconButton label={`Move ${station.name} up`} icon={ArrowUp} disabled={busy || index === 0} onClick={() => move(index, -1)} />
                    <IconButton label={`Move ${station.name} down`} icon={ArrowDown} disabled={busy || index === stations.length - 1} onClick={() => move(index, 1)} />
                  </div>
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-label-bold text-on-surface">
                    {station.name}
                    <span className="rounded-full bg-surface-container-high px-2 py-0.5 font-mono text-on-surface-variant">{station.code}</span>
                    {!station.isActive ? <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-on-surface-variant">Off</span> : null}
                  </p>
                  <p className="text-body-md text-on-surface-variant">
                    {canOpenProducts && station.productCount ? (
                      <Link href={`/dashboard/products?station=${station.id}`} className="text-primary hover:underline">{products(station.productCount)}</Link>
                    ) : (
                      products(station.productCount)
                    )}
                    {station.printerId ? ` · printer ${station.printerId}` : " · no printer set"}
                  </p>
                </div>
                {canManage ? (
                  <div className="flex flex-wrap gap-1">
                    <RowButton disabled={busy} onClick={() => setEditing(station.id)}>Edit</RowButton>
                    <RowButton
                      disabled={busy}
                      onClick={() => {
                        if (station.isActive && station.productCount && !window.confirm(`Switch off ${station.name}? New tickets for its ${products(station.productCount)} will show on every kitchen screen until it is back on.`)) return;
                        run(() => api.patch(`/admin/kitchen-stations/${station.id}`, { isActive: !station.isActive }), station.isActive ? `${station.name} switched off.` : `${station.name} switched on.`);
                      }}
                    >
                      {station.isActive ? "Switch off" : "Switch on"}
                    </RowButton>
                    <RowButton
                      tone="danger"
                      disabled={busy}
                      onClick={() => {
                        const detail = station.productCount ? ` Its ${products(station.productCount)} will no longer route to a station, and their tickets will show on every kitchen screen.` : "";
                        if (!window.confirm(`Delete ${station.name}?${detail} This cannot be undone.`)) return;
                        run(() => api.delete(`/admin/kitchen-stations/${station.id}`), `${station.name} deleted.`);
                      }}
                    >
                      Delete
                    </RowButton>
                  </div>
                ) : null}
              </li>
            ),
          )}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <CookingPot aria-hidden="true" className="size-8 text-on-surface-variant" />
          <p className="font-display text-headline-md text-on-surface">No stations yet</p>
          <p className="max-w-md text-body-md text-on-surface-variant">
            A station is where a ticket goes — grill, fryer, bar. Without any, every ticket shows on every kitchen screen.
          </p>
        </div>
      )}

      {canManage ? (
        editing === "new" ? (
          <StationForm onDone={() => setEditing(null)} />
        ) : (
          <button type="button" onClick={() => setEditing("new")} className="inline-flex w-fit items-center gap-2 rounded-field px-3 py-2 text-label-bold text-primary hover:underline">
            <Plus aria-hidden="true" className="size-4" />
            Add a station
          </button>
        )
      ) : null}
    </section>
  );
}

function StationForm({ station = null, onDone }) {
  const router = useRouter();
  const creating = !station;
  const [form, setForm] = useState(() => stationFormValues(station));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const prefix = station?.id ?? "new";
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const { body, errors: local } = stationPayload(form);
    if (Object.keys(local).length) return setErrors(local);
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      if (creating) await api.post("/admin/kitchen-stations", body);
      else await api.patch(`/admin/kitchen-stations/${station.id}`, body);
      toast.success(creating ? `${body.name} added.` : `${body.name} saved.`);
      onDone();
      router.refresh();
    } catch (failure) {
      const mapped = toFormErrors(failure, { fields: ["name", "code", "printerId"], conflictField: "code" });
      setErrors(mapped.fieldErrors);
      setFormError(mapped.formError);
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label={creating ? "New station" : `Edit ${station.name}`} className="flex flex-col gap-4 rounded-field border border-outline-variant p-4">
      <FormAlert>{formError}</FormAlert>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id={`station-name-${prefix}`} label="Name" autoFocus placeholder="e.g. Grill" value={form.name} onChange={update("name")} error={errors.name} />
        <Field id={`station-code-${prefix}`} label="Code" placeholder="e.g. GRILL" value={form.code} onChange={update("code")} error={errors.code} hint="Short, printed on tickets." />
        <Field id={`station-printer-${prefix}`} label="Printer" placeholder="Optional" value={form.printerId} onChange={update("printerId")} error={errors.printerId} hint="The printer's name or ID." />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {pending ? "Saving…" : creating ? "Add station" : "Save station"}
        </button>
        <button type="button" onClick={onDone} className="rounded-field px-5 py-2.5 text-label-bold text-on-surface-variant hover:text-on-surface">Cancel</button>
      </div>
    </form>
  );
}
