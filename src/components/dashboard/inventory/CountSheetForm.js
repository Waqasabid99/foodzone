"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { countPayload } from "@/lib/inventory";
import FormAlert from "@/components/ui/FormAlert";

/**
 * The count sheet, filled in blind.
 *
 * It never receives the system's figure — the page does not send it — for the
 * same reason a cash drawer is counted blind: someone who can see the
 * expected number finds the expected number.
 *
 * Entries are kept in this browser as they are typed, so a long count
 * survives a dropped connection or a phone that locks, and are cleared once
 * the sheet is submitted. Rendered in the browser only (see CountSheet), so
 * the saved entries can be the initial state rather than a second render.
 */
export default function CountSheetForm({ count }) {
  const router = useRouter();
  const storageKey = `fz_count_${count.id}`;
  const [saved] = useState(() => readSaved(storageKey));
  const [entries, setEntries] = useState(saved.entries);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [notes, setNotes] = useState(saved.notes);
  const [pending, setPending] = useState(false);
  const restored = Object.keys(saved.entries).length > 0;

  const save = (next, nextNotes = notes) => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ entries: next, notes: nextNotes }));
    } catch {
      // Not saved locally; the typed values are still on screen.
    }
  };

  const setEntry = (itemId, patch) =>
    setEntries((current) => {
      const next = { ...current, [itemId]: { ...current[itemId], ...patch } };
      save(next);
      return next;
    });

  const done = count.items.filter((line) => String(entries[line.itemId]?.counted ?? "").trim() !== "").length;

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const { lines, lineErrors } = countPayload(count.items, entries);
    setErrors(lineErrors);
    if (Object.keys(lineErrors).length) {
      setFormError(`${Object.keys(lineErrors).length} ${Object.keys(lineErrors).length === 1 ? "line needs" : "lines need"} a number. Enter 0 for anything that is not there.`);
      return;
    }
    if (!window.confirm("Submit this count? The numbers cannot be changed afterwards; a manager compares them with the system and posts the difference.")) return;
    setPending(true);
    setFormError(null);
    try {
      await api.post(`/admin/stock-counts/${count.id}/submit`, { lines, ...(notes.trim() ? { notes: notes.trim() } : {}) });
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // Nothing to clear.
      }
      toast.success(`Count ${count.countNumber} submitted.`);
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be submitted.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {restored ? <p className="rounded-field bg-secondary-container px-4 py-3 text-body-md text-on-secondary-container">Picked up where you left off on this device.</p> : null}
      <FormAlert>{formError}</FormAlert>
      <p className="text-body-md text-on-surface-variant" aria-live="polite">
        {done} of {count.items.length} counted
      </p>
      <ul className="flex flex-col gap-2">
        {count.items.map((line) => (
          <li key={line.itemId} className="grid gap-2 rounded-field bg-surface-container-low p-3 sm:grid-cols-[2fr_1fr_2fr] sm:items-start">
            <p className="text-body-md">
              <span className="block text-label-bold text-on-surface">{line.item.name}</span>
              <span className="font-mono text-on-surface-variant">{line.item.sku}</span>
            </p>
            <div className="flex flex-col gap-1">
              <label htmlFor={`count-${line.itemId}`} className="text-label-bold text-on-surface">Counted ({line.item.uom.code})</label>
              <input
                id={`count-${line.itemId}`}
                inputMode="decimal"
                autoComplete="off"
                value={entries[line.itemId]?.counted ?? ""}
                onChange={(event) => setEntry(line.itemId, { counted: event.target.value })}
                aria-invalid={errors[line.itemId] ? "true" : undefined}
                className={`w-full rounded-field bg-surface-container-lowest px-3 py-2.5 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring ${errors[line.itemId] ? "border border-error" : "border border-outline"}`}
              />
              {errors[line.itemId] ? <p className="text-label-bold text-error">{errors[line.itemId]}</p> : null}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`count-note-${line.itemId}`} className="text-label-bold text-on-surface">Note</label>
              <input
                id={`count-note-${line.itemId}`}
                value={entries[line.itemId]?.reason ?? ""}
                onChange={(event) => setEntry(line.itemId, { reason: event.target.value })}
                placeholder="Optional — torn bag, found in the walk-in"
                className="w-full rounded-field border border-outline bg-surface-container-lowest px-3 py-2.5 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring"
              />
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="count-notes" className="text-label-bold text-on-surface">Anything the approver should know</label>
        <textarea
          id="count-notes"
          rows={2}
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value);
            save(entries, event.target.value);
          }}
          className="w-full rounded-field border border-outline bg-surface-container-low px-4 py-3 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring"
        />
      </div>
      <button type="submit" disabled={pending} className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {pending ? "Submitting…" : "Submit count"}
      </button>
    </form>
  );
}

function readSaved(key) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(key) ?? "null");
    if (saved?.entries && typeof saved.entries === "object") return { entries: saved.entries, notes: String(saved.notes ?? "") };
  } catch {
    // Storage off or unreadable: the sheet simply starts empty.
  }
  return { entries: {}, notes: "" };
}
