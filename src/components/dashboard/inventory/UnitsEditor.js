"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Plus, Ruler } from "lucide-react";
import { api } from "@/lib/api-client";
import { toFormErrors } from "@/lib/form-errors";
import { UNIT_TYPES, unitPayload } from "@/lib/inventory";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";
import { RowButton } from "@/components/dashboard/menus/controls";

/**
 * Units of measure, grouped by what they measure.
 *
 * A conversion is spelled out as a sentence — "1 kg = 1000 g" — because a bare
 * factor column invites someone to type 0.001 for the same thing, and the two
 * readings differ by a million.
 */
export default function UnitsEditor({ units, canManage }) {
  const router = useRouter();
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function run(action, success) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      toast.success(typeof success === "function" ? success(result) : success);
      router.refresh();
    } catch (failure) {
      setMessage(failure?.message ?? "That change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const groups = UNIT_TYPES.map((type) => ({ ...type, units: units.filter((unit) => unit.type === type.value) })).filter(
    (group) => group.units.length,
  );
  const missingStandard = ["g", "kg", "ml", "l", "pc", "dz"].some((code) => !units.some((unit) => unit.code === code));

  return (
    <section className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5 sm:p-6">
      <FormAlert>{message}</FormAlert>

      {canManage && missingStandard ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-secondary-container px-4 py-3 text-on-secondary-container">
          <p className="text-body-md">
            {units.length ? "Some everyday units are missing." : "Start with the everyday units: gram, kilogram, millilitre, litre, piece and dozen."}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(
                () => api.post("/admin/units/standard"),
                (result) => (result?.created?.length ? `Added ${result.created.join(", ")}.` : "They were all there already."),
              )
            }
            className="rounded-field bg-primary-container px-4 py-2 text-label-bold text-on-primary-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Add standard units
          </button>
        </div>
      ) : null}

      {groups.length ? (
        groups.map((group) => (
          <div key={group.value} className="flex flex-col gap-2">
            <h2 className="text-label-bold uppercase tracking-wide text-on-surface-variant">{group.label}</h2>
            <ul className="flex flex-col gap-2">
              {group.units.map((unit) =>
                editing === unit.id ? (
                  <li key={unit.id}>
                    <UnitForm unit={unit} units={units} onDone={() => setEditing(null)} />
                  </li>
                ) : (
                  <li key={unit.id} className={`flex flex-wrap items-center gap-3 rounded-field bg-surface-container-low p-3 ${unit.isActive ? "" : "opacity-75"}`}>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-label-bold text-on-surface">
                        {unit.name}
                        <span className="rounded-full bg-surface-container-high px-2 py-0.5 font-mono text-on-surface-variant">{unit.code}</span>
                        {!unit.isActive ? <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-on-surface-variant">Off</span> : null}
                      </p>
                      <p className="text-body-md text-on-surface-variant">
                        {unit.baseUnit ? `1 ${unit.code} = ${Number(unit.factor).toLocaleString("en-US")} ${unit.baseUnit.code}` : "Base unit"}
                        {` · ${unit.precision} decimal ${unit.precision === 1 ? "place" : "places"}`}
                        {unit._count.items ? ` · ${unit._count.items} ${unit._count.items === 1 ? "item" : "items"}` : ""}
                      </p>
                    </div>
                    {canManage ? (
                      <div className="flex flex-wrap gap-1">
                        <RowButton disabled={busy} onClick={() => setEditing(unit.id)}>Edit</RowButton>
                        <RowButton
                          disabled={busy}
                          onClick={() => run(() => api.patch(`/admin/units/${unit.id}`, { isActive: !unit.isActive }), unit.isActive ? `${unit.code} switched off.` : `${unit.code} switched on.`)}
                        >
                          {unit.isActive ? "Switch off" : "Switch on"}
                        </RowButton>
                        <RowButton
                          tone="danger"
                          disabled={busy}
                          onClick={() => {
                            if (!window.confirm(`Delete ${unit.name}? This cannot be undone.`)) return;
                            run(() => api.delete(`/admin/units/${unit.id}`), `${unit.name} deleted.`);
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
          </div>
        ))
      ) : (
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <Ruler aria-hidden="true" className="size-8 text-on-surface-variant" />
          <p className="font-display text-headline-md text-on-surface">No units yet</p>
          <p className="max-w-md text-body-md text-on-surface-variant">Every item is counted in a unit, so this comes first.</p>
        </div>
      )}

      {canManage ? (
        editing === "new" ? (
          <UnitForm units={units} onDone={() => setEditing(null)} />
        ) : (
          <button type="button" onClick={() => setEditing("new")} className="inline-flex w-fit items-center gap-2 rounded-field px-3 py-2 text-label-bold text-primary hover:underline">
            <Plus aria-hidden="true" className="size-4" />
            Add a unit
          </button>
        )
      ) : null}
    </section>
  );
}

function UnitForm({ unit = null, units, onDone }) {
  const router = useRouter();
  const creating = !unit;
  const [form, setForm] = useState(() => ({
    code: unit?.code ?? "",
    name: unit?.name ?? "",
    type: unit?.type ?? "WEIGHT",
    baseUnitId: unit?.baseUnitId ?? "",
    factor: unit?.baseUnitId ? String(Number(unit.factor)) : "",
    precision: String(unit?.precision ?? 3),
  }));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const prefix = unit?.id ?? "new";
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const inUse = Boolean(unit?._count?.items || unit?._count?.derived);
  const bases = units.filter((option) => option.type === form.type && !option.baseUnitId && option.id !== unit?.id);
  const base = bases.find((option) => option.id === form.baseUnitId);

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const { body, errors: local } = unitPayload(form);
    if (Object.keys(local).length) return setErrors(local);
    // A unit in use keeps its conversion; sending it unchanged is still a
    // change the server has to inspect, so it is left out.
    if (inUse) {
      delete body.type;
      delete body.baseUnitId;
      delete body.factor;
    }
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      if (creating) await api.post("/admin/units", body);
      else await api.patch(`/admin/units/${unit.id}`, body);
      toast.success(creating ? `${body.name} added.` : `${body.name} saved.`);
      onDone();
      router.refresh();
    } catch (failure) {
      const mapped = toFormErrors(failure, { fields: ["code", "name", "type", "baseUnitId", "factor", "precision"], conflictField: "code" });
      setErrors(mapped.fieldErrors);
      setFormError(mapped.formError);
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label={creating ? "New unit" : `Edit ${unit.name}`} className="flex flex-col gap-4 rounded-field border border-outline-variant p-4">
      <FormAlert>{formError}</FormAlert>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id={`unit-name-${prefix}`} label="Name" autoFocus placeholder="e.g. Kilogram" value={form.name} onChange={update("name")} error={errors.name} />
        <Field id={`unit-code-${prefix}`} label="Code" placeholder="e.g. kg" value={form.code} onChange={update("code")} error={errors.code} hint="Shown after every quantity." />
        <Field id={`unit-precision-${prefix}`} label="Decimal places" type="number" inputMode="numeric" min="0" max="6" value={form.precision} onChange={update("precision")} error={errors.precision} hint="0 for things counted whole." />
      </div>
      <fieldset disabled={inUse} className="grid gap-4 sm:grid-cols-3">
        <SelectField
          id={`unit-type-${prefix}`}
          label="Measures"
          value={form.type}
          onChange={(event) => setForm((current) => ({ ...current, type: event.target.value, baseUnitId: "" }))}
          options={UNIT_TYPES}
          error={errors.type}
        />
        <SelectField
          id={`unit-base-${prefix}`}
          label="Converts to"
          value={form.baseUnitId}
          onChange={update("baseUnitId")}
          options={[{ value: "", label: "Nothing — this is a base unit" }, ...bases.map((option) => ({ value: option.id, label: `${option.name} (${option.code})` }))]}
          error={errors.baseUnitId}
        />
        {form.baseUnitId ? (
          <Field
            id={`unit-factor-${prefix}`}
            label={`${base?.code ?? "Base units"} in one ${form.code || "of these"}`}
            inputMode="decimal"
            placeholder="e.g. 1000"
            value={form.factor}
            onChange={update("factor")}
            error={errors.factor}
            hint={form.factor && base ? `1 ${form.code || "unit"} = ${form.factor} ${base.code}` : null}
          />
        ) : null}
      </fieldset>
      {inUse ? (
        <p className="text-body-md text-on-surface-variant">Items already use this unit, so what it measures and converts to cannot change — past quantities were stored using it.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {pending ? "Saving…" : creating ? "Add unit" : "Save unit"}
        </button>
        <button type="button" onClick={onDone} className="rounded-field px-5 py-2.5 text-label-bold text-on-surface-variant hover:text-on-surface">Cancel</button>
      </div>
    </form>
  );
}
