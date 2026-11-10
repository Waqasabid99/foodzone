"use client";

import { useState } from "react";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import FormAlert from "@/components/ui/FormAlert";

/**
 * Which messages this person wants, and which ones may wake their phone.
 *
 * Two columns rather than one switch per category, because the two are
 * genuinely different questions and conflating them is what makes
 * notification settings infuriating. "Do you want to know your order was
 * cancelled" has one honest answer. "Should your phone buzz about it" has two.
 *
 * So a transactional category shows its record as a fixed line of text rather
 * than a disabled switch. A greyed-out control invites a click and then says
 * nothing; a sentence explains itself. Which categories work that way is the
 * server's call — the screen renders `canMuteInApp` rather than reimplementing
 * the rule and drifting from it.
 */
export default function NotificationPreferences({ initial = [] }) {
  const [rows, setRows] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function toggle(key, field, value) {
    // Optimistic: a switch that waits for a round trip before moving feels
    // broken, and the only recovery needed is putting it back.
    const before = rows;
    setRows((current) => current.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
    setPending(true);
    setError(null);

    try {
      const saved = await api.put("/me/notification-preferences", { categories: { [key]: { [field]: value } } });
      setRows(Array.isArray(saved) ? saved : (saved?.items ?? before));
      toast.success("Saved");
    } catch (problem) {
      setRows(before);
      setError(problem?.message ?? "That could not be saved.");
    } finally {
      setPending(false);
    }
  }

  if (!rows.length) return null;

  return (
    <section className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
      <div>
        <h2 className="text-title-sm text-on-surface">What you hear about</h2>
        <p className="text-body-md text-on-surface-variant">
          Anything that is a record of something — your orders, your payments — stays in the list above whatever you
          choose here. What you can switch off is being interrupted about it.
        </p>
      </div>

      <ul className="flex flex-col divide-y divide-outline-variant/60">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
            <div className="min-w-48 flex-1">
              <p className="text-label-bold text-on-surface">{row.label}</p>
              <p className="text-body-sm text-on-surface-variant">{row.description}</p>
            </div>

            <div className="flex flex-wrap items-center gap-5">
              {row.canMuteInApp ? (
                <label className="flex min-h-11 items-center gap-2 text-body-md text-on-surface">
                  <input
                    type="checkbox"
                    checked={Boolean(row.inApp)}
                    disabled={pending}
                    onChange={(event) => toggle(row.key, "inApp", event.target.checked)}
                    className="size-4 accent-primary"
                  />
                  Send these
                </label>
              ) : (
                <p className="min-h-11 content-center text-body-sm text-on-surface-variant">Always recorded</p>
              )}

              <label className="flex min-h-11 items-center gap-2 text-body-md text-on-surface">
                <input
                  type="checkbox"
                  checked={Boolean(row.push)}
                  disabled={pending || (row.canMuteInApp && !row.inApp)}
                  onChange={(event) => toggle(row.key, "push", event.target.checked)}
                  className="size-4 accent-primary"
                />
                Alert my phone
              </label>
            </div>
          </li>
        ))}
      </ul>

      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
    </section>
  );
}
