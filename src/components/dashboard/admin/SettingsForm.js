"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import FormAlert from "@/components/ui/FormAlert";
import Chip from "@/components/dashboard/inventory/Chip";

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * One group of settings.
 *
 * Only what actually changed is sent, so two people editing different sections
 * do not overwrite each other. When a branch is selected, a value it does not
 * override is shown as inherited rather than as its own — and can be handed
 * back with "use the company value", which deletes the override instead of
 * copying the number into it.
 */
export default function SettingsForm({ group, settings, branchId = null, canEdit }) {
  const router = useRouter();
  const initial = useMemo(() => Object.fromEntries(settings.map((setting) => [setting.key, setting.value])), [settings]);
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const changed = settings.filter((setting) => !sameValue(values[setting.key], initial[setting.key]));
  const set = (key, value) => setValues((current) => ({ ...current, [key]: value }));

  async function save() {
    if (pending || !changed.length) return;
    setPending(true);
    setError(null);
    setErrors({});
    try {
      await api.put("/admin/settings", {
        branchId: branchId ?? null,
        values: Object.fromEntries(changed.map((setting) => [setting.key, values[setting.key]])),
      });
      toast.success(`${group} saved.`);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "They could not be saved.");
      if (failure?.details && typeof failure.details === "object") setErrors(failure.details);
    } finally {
      setPending(false);
    }
  }

  async function reset(setting) {
    if (!window.confirm(branchId ? "Use the company-wide value here?" : "Go back to the value the system ships with?")) return;
    try {
      await api.delete(`/admin/settings/${encodeURIComponent(setting.key)}${branchId ? `?branchId=${branchId}` : ""}`);
      toast.success("Reset.");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "It could not be reset.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <FormAlert>{error}</FormAlert>

      <ul className="flex flex-col gap-4">
        {settings.map((setting) => {
          const problems = errors[setting.key];
          const locked = !canEdit || (Boolean(branchId) && !setting.branchOverridable);
          const overridden = branchId ? setting.source === "BRANCH" : setting.source === "GLOBAL";
          return (
            <li key={setting.key} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <label htmlFor={`setting-${setting.key}`} className="text-label-bold text-on-surface">{setting.label}</label>
                <span className="flex items-center gap-2">
                  {branchId && !setting.branchOverridable ? <Chip>Company-wide only</Chip> : null}
                  {branchId && setting.branchOverridable && !overridden ? <Chip>Same as company</Chip> : null}
                  {setting.isPublic ? <Chip>Shown to customers</Chip> : null}
                </span>
              </div>

              <Control setting={setting} value={values[setting.key]} onChange={(next) => set(setting.key, next)} disabled={locked} />

              <p className="text-label-bold font-normal text-on-surface-variant">
                <span className="font-mono">{setting.key}</span>
                {overridden && canEdit ? (
                  <>
                    {" · "}
                    <button type="button" onClick={() => reset(setting)} className="text-primary underline">
                      {branchId ? "use the company value" : "back to the default"}
                    </button>
                  </>
                ) : null}
              </p>
              {problems ? <p className="text-label-bold text-error">{Array.isArray(problems) ? problems.join(" ") : String(problems)}</p> : null}
            </li>
          );
        })}
      </ul>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={pending || !changed.length}
            className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {pending ? "Saving…" : `Save ${group.toLowerCase()}`}
          </button>
          {changed.length ? (
            <button type="button" onClick={() => setValues(initial)} className="text-label-bold text-on-surface-variant hover:underline">
              Undo {changed.length} {changed.length === 1 ? "change" : "changes"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const inputClass =
  "w-full rounded-field border border-transparent bg-surface-container-lowest px-3 py-2.5 text-body-md text-on-surface disabled:opacity-60 focus:outline-2 focus:outline-offset-2 focus:outline-ring";

function Control({ setting, value, onChange, disabled }) {
  const id = `setting-${setting.key}`;

  if (setting.type === "boolean") {
    return (
      <label htmlFor={id} className="flex min-h-11 w-fit items-center gap-3 rounded-field bg-surface-container-low px-4 text-body-md text-on-surface">
        <input id={id} type="checkbox" checked={Boolean(value)} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="size-4 accent-primary" />
        {value ? "Yes" : "No"}
      </label>
    );
  }

  if (setting.type === "number") {
    return (
      <input
        id={id}
        inputMode="decimal"
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => {
          const text = event.target.value.trim();
          onChange(text === "" ? 0 : Number.isNaN(Number(text)) ? text : Number(text));
        }}
        className={inputClass}
      />
    );
  }

  if (setting.type === "json" && setting.options) {
    const list = Array.isArray(value) ? value : [];
    return (
      <ul className="flex flex-wrap gap-2" id={id}>
        {setting.options.map((option) => {
          const checked = list.includes(option.value);
          return (
            <li key={option.value}>
              <label className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-field px-4 text-body-md ${checked ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-low text-on-surface"} ${disabled ? "opacity-60" : "hover:bg-surface-container"}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onChange(checked ? list.filter((entry) => entry !== option.value) : [...list, option.value])}
                  className="size-4 accent-primary"
                />
                {option.label}
              </label>
            </li>
          );
        })}
      </ul>
    );
  }

  if (setting.type === "json") {
    return (
      <textarea
        id={id}
        rows={3}
        disabled={disabled}
        value={typeof value === "string" ? value : JSON.stringify(value ?? null)}
        onChange={(event) => {
          try {
            onChange(JSON.parse(event.target.value));
          } catch {
            onChange(event.target.value);
          }
        }}
        className={`${inputClass} font-mono`}
      />
    );
  }

  const long = setting.key.endsWith("message") || setting.key.endsWith("tagline");
  return long ? (
    <textarea id={id} rows={2} value={value ?? ""} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={inputClass} />
  ) : (
    <input id={id} value={value ?? ""} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={inputClass} />
  );
}
