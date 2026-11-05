"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import { toFormErrors } from "@/lib/form-errors";
import { formatMoney } from "@/lib/format";
import { modifierOptionPayload } from "@/lib/modifier-rules";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";

function signed(amount, currency) {
  const value = Number(amount);
  if (!value) return "No charge";
  return `${value > 0 ? "+" : "−"}${formatMoney(Math.abs(value), currency)}`;
}

/**
 * A group's choices, each saved on its own.
 *
 * The server refuses any change that would leave the group — or a product that
 * sets its own limits for it — asking for more than it offers, and says which
 * product. That refusal is shown as written: it is the most useful sentence on
 * the screen when it appears.
 */
export default function ModifierOptionsEditor({ group, currency, canEdit }) {
  const router = useRouter();
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const options = group.options;

  async function run(action, success) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (success) toast.success(success);
      router.refresh();
      return true;
    } catch (failure) {
      setMessage(failure?.message ?? "That change could not be saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const patch = (optionId, body) => api.patch(`/admin/modifier-groups/${group.id}/options/${optionId}`, body);

  // No bulk endpoint for option order, so only the rows whose position changed
  // are sent — normally two.
  const move = (index, by) =>
    run(async () => {
      const next = [...options];
      [next[index], next[index + by]] = [next[index + by], next[index]];
      for (const [position, option] of next.entries()) {
        if (option.sortOrder !== position) await patch(option.id, { sortOrder: position });
      }
    });

  return (
    <Section
      title="Choices"
      description={`${group.selectionType === "SINGLE" ? "Customers pick one." : "Customers pick several."} Price adjustments in ${currency}.`}
    >
      <FormAlert>{message}</FormAlert>

      {options.length ? (
        <ul className="flex flex-col gap-2">
          {options.map((option, index) =>
            editing === option.id ? (
              <li key={option.id}>
                <OptionForm group={group} option={option} currency={currency} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={option.id} className={`flex flex-wrap items-center gap-3 rounded-field bg-surface-container-low p-3 ${option.isActive ? "" : "opacity-75"}`}>
                {canEdit ? (
                  <div className="flex flex-col">
                    <IconButton label={`Move ${option.name} up`} icon={ArrowUp} disabled={busy || index === 0} onClick={() => move(index, -1)} />
                    <IconButton label={`Move ${option.name} down`} icon={ArrowDown} disabled={busy || index === options.length - 1} onClick={() => move(index, 1)} />
                  </div>
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-label-bold text-on-surface">
                    {option.name}
                    {option.isDefault ? <span className="rounded-full bg-secondary-container px-2 py-0.5 text-on-secondary-container">Pre-selected</span> : null}
                    {!option.isActive ? <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-on-surface-variant">Off</span> : null}
                  </p>
                  <p className="text-body-md tabular-nums text-on-surface-variant">{signed(option.priceDelta, currency)}</p>
                </div>
                {canEdit ? (
                  <div className="flex flex-wrap gap-1">
                    <RowButton disabled={busy} onClick={() => setEditing(option.id)}>Edit</RowButton>
                    <RowButton
                      disabled={busy || !option.isActive}
                      onClick={() => run(() => patch(option.id, { isDefault: !option.isDefault }), option.isDefault ? `${option.name} is no longer pre-selected.` : `${option.name} is pre-selected.`)}
                    >
                      {option.isDefault ? "Unselect" : "Pre-select"}
                    </RowButton>
                    <RowButton
                      disabled={busy}
                      onClick={() => run(() => patch(option.id, { isActive: !option.isActive }), option.isActive ? `${option.name} switched off.` : `${option.name} switched on.`)}
                    >
                      {option.isActive ? "Switch off" : "Switch on"}
                    </RowButton>
                    <RowButton
                      tone="danger"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`Delete "${option.name}"? This cannot be undone.`)) return;
                        run(() => api.delete(`/admin/modifier-groups/${group.id}/options/${option.id}`), `${option.name} deleted.`);
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
        <p className="text-body-md text-on-surface-variant">No choices yet.</p>
      )}

      {canEdit ? (
        editing === "new" ? (
          <OptionForm group={group} currency={currency} onDone={() => setEditing(null)} />
        ) : (
          <button type="button" onClick={() => setEditing("new")} className="inline-flex w-fit items-center gap-2 rounded-field px-3 py-2 text-label-bold text-primary hover:underline">
            <Plus aria-hidden="true" className="size-4" />
            Add a choice
          </button>
        )
      ) : null}
    </Section>
  );
}

function OptionForm({ group, option = null, currency, onDone }) {
  const router = useRouter();
  const creating = !option;
  const [form, setForm] = useState({ name: option?.name ?? "", priceDelta: option && Number(option.priceDelta) ? String(option.priceDelta) : "" });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const prefix = option?.id ?? "new";

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const { body, errors: local } = modifierOptionPayload(form);
    if (Object.keys(local).length) return setErrors(local);
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      if (creating) await api.post(`/admin/modifier-groups/${group.id}/options`, body);
      else await api.patch(`/admin/modifier-groups/${group.id}/options/${option.id}`, body);
      toast.success(creating ? `${body.name} added.` : `${body.name} saved.`);
      onDone();
      router.refresh();
    } catch (failure) {
      const mapped = toFormErrors(failure, { fields: ["name", "priceDelta"], conflictField: "name" });
      setErrors(mapped.fieldErrors);
      setFormError(mapped.formError);
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label={creating ? "New choice" : `Edit ${option.name}`} className="flex flex-col gap-4 rounded-field border border-outline-variant p-4">
      <FormAlert>{formError}</FormAlert>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`opt-name-${prefix}`} label="Choice" autoFocus placeholder="e.g. Extra cheese" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} error={errors.name} />
        <Field
          id={`opt-delta-${prefix}`}
          label={`Adds (${currency})`}
          inputMode="decimal"
          placeholder="0"
          value={form.priceDelta}
          onChange={(event) => setForm((current) => ({ ...current, priceDelta: event.target.value }))}
          error={errors.priceDelta}
          hint="Use a minus for a discount, e.g. -50."
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {pending ? "Saving…" : creating ? "Add choice" : "Save choice"}
        </button>
        <button type="button" onClick={onDone} className="rounded-field px-5 py-2.5 text-label-bold text-on-surface-variant hover:text-on-surface">
          Cancel
        </button>
      </div>
    </form>
  );
}

function RowButton({ tone = "neutral", children, ...props }) {
  return (
    <button
      type="button"
      className={`rounded-field px-3 py-2 text-label-bold hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40 ${tone === "danger" ? "text-error" : "text-on-surface"}`}
      {...props}
    >
      {children}
    </button>
  );
}

function IconButton({ label, icon: Icon, ...props }) {
  return (
    <button type="button" aria-label={label} title={label} className="inline-flex size-10 items-center justify-center rounded-field text-on-surface-variant hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-30" {...props}>
      <Icon aria-hidden="true" className="size-4" />
    </button>
  );
}
