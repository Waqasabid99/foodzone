"use client";

import { useMemo, useState } from "react";
import { moduleState, toggleModule } from "@/lib/people";

export const moduleLabel = (module) => module.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());

/**
 * The permission picker, module by module.
 *
 * Permissions the person does not hold themselves are shown but cannot be
 * ticked: the server refuses to let anyone grant more than they have, and a
 * box that fails on save is worse than one that explains itself up front.
 */
export default function PermissionMatrix({ modules, selected, onChange, canEdit = true, holds = [], isSuperAdmin = false }) {
  const [query, setQuery] = useState("");
  const held = useMemo(() => new Set(holds), [holds]);
  const canGrant = (key) => isSuperAdmin || held.has(key);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return modules;
    return modules
      .map((module) => ({
        ...module,
        permissions: module.permissions.filter(
          (permission) =>
            permission.key.toLowerCase().includes(needle) ||
            (permission.label ?? "").toLowerCase().includes(needle) ||
            moduleLabel(module.module).toLowerCase().includes(needle),
        ),
      }))
      .filter((module) => module.permissions.length);
  }, [modules, query]);

  const toggle = (key) => onChange(selected.includes(key) ? selected.filter((value) => value !== key) : [...selected, key]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <label htmlFor="permission-search" className="text-label-bold text-on-surface">Find a permission</label>
          <input
            id="permission-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="e.g. refund, stock, payroll"
            className="w-full rounded-field border border-transparent bg-surface-container-low px-3 py-2.5 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring"
          />
        </div>
        <p className="text-body-md text-on-surface-variant" aria-live="polite">{selected.length} selected</p>
      </div>

      {visible.length ? (
        <ul className="flex flex-col gap-3">
          {visible.map((module) => {
            const keys = module.permissions.map((permission) => permission.key);
            const grantableKeys = keys.filter(canGrant);
            const state = moduleState(keys, selected);
            return (
              <li key={module.module} className="rounded-field bg-surface-container-low p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-label-bold text-on-surface">{moduleLabel(module.module)}</h3>
                  {canEdit && grantableKeys.length ? (
                    <button type="button" onClick={() => onChange(toggleModule(grantableKeys, selected))} className="rounded-field px-3 py-1.5 text-label-bold text-primary hover:underline">
                      {state === "all" ? "Clear all" : "Select all"}
                    </button>
                  ) : null}
                </div>
                <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                  {module.permissions.map((permission) => {
                    const allowed = canGrant(permission.key);
                    return (
                      <li key={permission.key}>
                        <label className={`flex items-start gap-3 rounded-field px-3 py-2 ${allowed && canEdit ? "cursor-pointer hover:bg-surface-container" : "opacity-70"}`}>
                          <input
                            type="checkbox"
                            checked={selected.includes(permission.key)}
                            disabled={!canEdit || !allowed}
                            onChange={() => toggle(permission.key)}
                            className="mt-1 size-4 accent-primary"
                          />
                          <span className="min-w-0">
                            <span className="block text-balance text-body-md text-on-surface">{permission.label ?? permission.key}</span>
                            {/* Keys like "attendance_devices.sync" are wider than a phone. */}
                            <span className="block break-all font-mono text-label-bold font-normal text-on-surface-variant">{permission.key}</span>
                            {!allowed ? <span className="block text-label-bold font-normal text-on-surface-variant">You do not hold this yourself.</span> : null}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-body-md text-on-surface-variant">Nothing matches “{query}”.</p>
      )}
    </div>
  );
}
