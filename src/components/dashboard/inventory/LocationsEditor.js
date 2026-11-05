"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import { toFormErrors } from "@/lib/form-errors";
import { LOCATION_TYPES, locationPayload } from "@/lib/inventory";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";
import { RowButton } from "@/components/dashboard/menus/controls";

const TYPE_LABELS = Object.fromEntries(LOCATION_TYPES.map((type) => [type.value, type.label]));

/**
 * One branch's stock locations.
 *
 * The default is called out in words because it is not cosmetic: it is where
 * every sale takes its ingredients from. A branch without one falls back to
 * whichever location sorts first, which is rarely the one anybody meant.
 */
export default function LocationsEditor({ branch, locations, canManage }) {
  const router = useRouter();
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function run(action, success) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      toast.success(success);
      router.refresh();
    } catch (failure) {
      setMessage(failure?.message ?? "That change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const hasDefault = locations.some((location) => location.isDefault && location.isActive);

  return (
    <section aria-labelledby={`branch-${branch.id}`} className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5 sm:p-6">
      <h2 id={`branch-${branch.id}`} className="font-display text-headline-md text-on-surface">{branch.name}</h2>
      <FormAlert>{message}</FormAlert>

      {locations.length && !hasDefault ? (
        <p className="rounded-field bg-warning-container px-4 py-3 text-body-md text-on-warning-container">
          No location here is marked as where sales take stock from. Choose one with “Use for sales”.
        </p>
      ) : null}

      {locations.length ? (
        <ul className="flex flex-col gap-2">
          {locations.map((location) =>
            editing === location.id ? (
              <li key={location.id}>
                <LocationForm branchId={branch.id} location={location} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={location.id} className={`flex flex-wrap items-center gap-3 rounded-field bg-surface-container-low p-3 ${location.isActive ? "" : "opacity-75"}`}>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-label-bold text-on-surface">
                    {location.name}
                    <span className="rounded-full bg-surface-container-high px-2 py-0.5 font-mono text-on-surface-variant">{location.code}</span>
                    {location.isDefault ? <span className="rounded-full bg-secondary-container px-2 py-0.5 text-on-secondary-container">Sales take stock from here</span> : null}
                    {!location.isActive ? <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-on-surface-variant">Off</span> : null}
                  </p>
                  <p className="text-body-md text-on-surface-variant">
                    {TYPE_LABELS[location.type] ?? location.type}
                    {` · ${location._count.levels} ${location._count.levels === 1 ? "item" : "items"} held`}
                  </p>
                </div>
                {canManage ? (
                  <div className="flex flex-wrap gap-1">
                    {!location.isDefault && location.isActive ? (
                      <RowButton disabled={busy} onClick={() => run(() => api.patch(`/admin/stock-locations/${location.id}`, { isDefault: true }), `Sales at ${branch.name} now take stock from ${location.name}.`)}>
                        Use for sales
                      </RowButton>
                    ) : null}
                    <RowButton disabled={busy} onClick={() => setEditing(location.id)}>Edit</RowButton>
                    <RowButton
                      disabled={busy}
                      onClick={() => {
                        if (location.isActive && location.isDefault && !window.confirm(`Switch off ${location.name}? Sales take stock from it; until another location is chosen they will use whichever comes first.`)) return;
                        run(() => api.patch(`/admin/stock-locations/${location.id}`, { isActive: !location.isActive }), location.isActive ? `${location.name} switched off.` : `${location.name} switched on.`);
                      }}
                    >
                      {location.isActive ? "Switch off" : "Switch on"}
                    </RowButton>
                  </div>
                ) : null}
              </li>
            ),
          )}
        </ul>
      ) : (
        <p className="text-body-md text-on-surface-variant">No locations yet. Most branches start with one store room and add a kitchen or a cold room when they want to count them apart.</p>
      )}

      {canManage ? (
        editing === "new" ? (
          <LocationForm branchId={branch.id} first={!locations.length} onDone={() => setEditing(null)} />
        ) : (
          <button type="button" onClick={() => setEditing("new")} className="inline-flex w-fit items-center gap-2 rounded-field px-3 py-2 text-label-bold text-primary hover:underline">
            <Plus aria-hidden="true" className="size-4" />
            Add a location
          </button>
        )
      ) : null}
    </section>
  );
}

function LocationForm({ branchId, location = null, first = false, onDone }) {
  const router = useRouter();
  const creating = !location;
  const [form, setForm] = useState(() => ({
    name: location?.name ?? (first ? "Main store" : ""),
    code: location?.code ?? (first ? "MAIN" : ""),
    type: location?.type ?? "MAIN_STORE",
    isDefault: location?.isDefault ?? first,
  }));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const prefix = location?.id ?? `new-${branchId}`;
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const { body, errors: local } = locationPayload(form);
    if (Object.keys(local).length) return setErrors(local);
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      if (creating) await api.post("/admin/stock-locations", { ...body, branchId });
      else await api.patch(`/admin/stock-locations/${location.id}`, body);
      toast.success(creating ? `${body.name} added.` : `${body.name} saved.`);
      onDone();
      router.refresh();
    } catch (failure) {
      const mapped = toFormErrors(failure, { fields: ["name", "code", "type"], conflictField: "code" });
      setErrors(mapped.fieldErrors);
      setFormError(mapped.formError);
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label={creating ? "New location" : `Edit ${location.name}`} className="flex flex-col gap-4 rounded-field border border-outline-variant p-4">
      <FormAlert>{formError}</FormAlert>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id={`location-name-${prefix}`} label="Name" autoFocus placeholder="e.g. Main store" value={form.name} onChange={update("name")} error={errors.name} />
        <Field id={`location-code-${prefix}`} label="Code" placeholder="e.g. MAIN" value={form.code} onChange={update("code")} error={errors.code} hint="Short, unique within the branch." />
        <SelectField id={`location-type-${prefix}`} label="Kind" value={form.type} onChange={update("type")} options={LOCATION_TYPES} error={errors.type} />
      </div>
      <label htmlFor={`location-default-${prefix}`} className="flex items-start gap-3">
        <input
          id={`location-default-${prefix}`}
          type="checkbox"
          checked={form.isDefault}
          onChange={(event) => setForm((current) => ({ ...current, isDefault: event.target.checked }))}
          className="mt-1 size-4 accent-primary"
        />
        <span className="text-body-md text-on-surface">
          Sales take stock from here
          <span className="block text-on-surface-variant">One per branch. Choosing this one moves it from wherever it was.</span>
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {pending ? "Saving…" : creating ? "Add location" : "Save location"}
        </button>
        <button type="button" onClick={onDone} className="rounded-field px-5 py-2.5 text-label-bold text-on-surface-variant hover:text-on-surface">Cancel</button>
      </div>
    </form>
  );
}
