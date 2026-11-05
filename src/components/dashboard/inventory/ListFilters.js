"use client";

import { useRef } from "react";
import { Search } from "lucide-react";

const control =
  "w-full rounded-field border border-transparent bg-surface-container-low px-3 py-2.5 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring";

/**
 * The filter bar every inventory list shares, held in the URL.
 *
 * Selects and checkboxes apply as soon as they change; text and dates wait
 * for Search, because re-running a query on every keystroke fights the person
 * typing. `hidden` carries state the bar does not show — the active tab —
 * through a submit.
 */
export default function ListFilters({ id, fields, hidden = {}, submitLabel = "Search" }) {
  const form = useRef(null);
  const submit = () => form.current?.requestSubmit();
  const needsButton = fields.some((field) => field.type === "search" || field.type === "date");

  return (
    <form ref={form} method="get" className="flex flex-wrap items-end gap-3 rounded-card bg-surface-container-lowest p-4">
      {Object.entries(hidden).map(([name, value]) => (value ? <input key={name} type="hidden" name={name} value={value} /> : null))}

      {fields.map((field) => {
        const fieldId = `${id}-${field.name}`;
        if (field.type === "search") {
          return (
            <div key={field.name} className="flex min-w-56 flex-[2] flex-col gap-1.5">
              <label htmlFor={fieldId} className="text-label-bold text-on-surface">{field.label}</label>
              <div className="relative">
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-on-surface-variant" />
                <input id={fieldId} name={field.name} type="search" defaultValue={field.value} placeholder={field.placeholder} className={`${control} pl-9`} />
              </div>
            </div>
          );
        }
        if (field.type === "select") {
          return (
            <div key={field.name} className="flex min-w-44 flex-1 flex-col gap-1.5">
              <label htmlFor={fieldId} className="text-label-bold text-on-surface">{field.label}</label>
              <select id={fieldId} name={field.name} defaultValue={field.value} onChange={submit} className={control}>
                {field.options.map((option) =>
                  option.group ? (
                    <optgroup key={option.group} label={option.group}>
                      {option.options.map((inner) => (
                        <option key={inner.value} value={inner.value}>{inner.label}</option>
                      ))}
                    </optgroup>
                  ) : (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ),
                )}
              </select>
            </div>
          );
        }
        if (field.type === "date") {
          return (
            <div key={field.name} className="flex min-w-40 flex-1 flex-col gap-1.5">
              <label htmlFor={fieldId} className="text-label-bold text-on-surface">{field.label}</label>
              <input id={fieldId} name={field.name} type="date" defaultValue={field.value} className={control} />
            </div>
          );
        }
        if (field.type === "checkbox") {
          return (
            <label key={field.name} htmlFor={fieldId} className="flex min-h-11 items-center gap-2 rounded-field px-2 text-body-md text-on-surface">
              <input id={fieldId} name={field.name} type="checkbox" value="1" defaultChecked={Boolean(field.value)} onChange={submit} className="size-4 accent-primary" />
              {field.label}
            </label>
          );
        }
        return null;
      })}

      {needsButton ? (
        <button type="submit" className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {submitLabel}
        </button>
      ) : (
        <noscript>
          <button type="submit" className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface">Apply</button>
        </noscript>
      )}
    </form>
  );
}
