"use client";

import { useRef } from "react";
import { MENU_TYPES } from "@/lib/menu-schedule";

/** Branch and channel, held in the URL like the other list filters. */
export default function MenuFilters({ branch = "", type = "", branches = [] }) {
  const form = useRef(null);
  const submit = () => form.current?.requestSubmit();
  const control =
    "w-full rounded-field border border-outline bg-surface-container-low px-3 py-2.5 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring";

  return (
    <form ref={form} method="get" className="flex flex-wrap items-end gap-3 rounded-card bg-surface-container-lowest p-4">
      {branches.length > 1 ? (
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <label htmlFor="menu-branch" className="text-label-bold text-on-surface">Branch</label>
          <select id="menu-branch" name="branch" defaultValue={branch} onChange={submit} className={control}>
            <option value="">All branches</option>
            {branches.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="flex min-w-48 flex-1 flex-col gap-1.5">
        <label htmlFor="menu-type" className="text-label-bold text-on-surface">Used for</label>
        <select id="menu-type" name="type" defaultValue={type} onChange={submit} className={control}>
          <option value="">Every channel</option>
          {MENU_TYPES.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      <noscript>
        <button type="submit" className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface">Apply</button>
      </noscript>
    </form>
  );
}
