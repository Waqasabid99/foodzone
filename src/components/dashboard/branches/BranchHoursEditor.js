"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Copy } from "lucide-react";
import { api } from "@/lib/api-client";
import FormAlert from "@/components/ui/FormAlert";
import { DAY_NAMES, hoursPayload, hoursToForm } from "@/lib/branch-hours";

/**
 * The trading week.
 *
 * This screen did not exist. The endpoint always has, and the branch page has
 * always had a panel headed "Opening hours" that said "No hours set." — so a
 * new branch had no trading hours, nothing in the dashboard could give it any,
 * and the storefront decided whether the shop was open from an empty schedule.
 *
 * **Whole week in, whole week out.** The endpoint is a PUT that replaces the
 * schedule, because editing hours is always "here is the new week" — merging
 * would leave a window alive that somebody thought they had deleted. So this
 * form holds all seven days and sends all seven.
 */
export default function BranchHoursEditor({ branchId, timezone, hours, canEdit }) {
  const router = useRouter();
  const [rows, setRows] = useState(() => hoursToForm(hours));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const patch = (dayOfWeek, change) =>
    setRows((current) => current.map((row) => (row.dayOfWeek === dayOfWeek ? { ...row, ...change } : row)));

  /** Most shops keep one set of hours; typing them seven times is the tax. */
  function copyDown(row) {
    setRows((current) =>
      current.map((other) =>
        other.dayOfWeek <= row.dayOfWeek
          ? other
          : { ...other, open: row.open, opensAt: row.opensAt, closesAt: row.closesAt, overnight: row.overnight },
      ),
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending || !canEdit) return;

    const { hours: body, errors: local } = hoursPayload(rows);
    setErrors(local);
    if (Object.keys(local).length) {
      setFormError(`Check ${DAY_NAMES[Object.keys(local)[0]]}.`);
      return;
    }

    setPending(true);
    setFormError(null);

    try {
      await api.put(`/admin/branches/${branchId}/hours`, { hours: body });
      toast.success(body.length ? `Open ${body.length} ${body.length === 1 ? "day" : "days"} a week.` : "Hours cleared — the branch has no trading week.");
      router.refresh();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <FormAlert>{formError}</FormAlert>

      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li
            key={row.dayOfWeek}
            className={`flex flex-wrap items-center gap-3 rounded-field px-4 py-3 ${row.open ? "bg-surface-container-low" : ""}`}
          >
            <label className="flex w-36 shrink-0 cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={row.open}
                disabled={!canEdit}
                onChange={(event) => patch(row.dayOfWeek, { open: event.target.checked })}
                className="size-5 accent-primary"
              />
              <span className="text-label-bold text-on-surface">{row.name}</span>
            </label>

            {row.open ? (
              <>
                <span className="flex items-center gap-2">
                  <label className="sr-only" htmlFor={`opens-${row.dayOfWeek}`}>
                    {row.name} opens at
                  </label>
                  <input
                    id={`opens-${row.dayOfWeek}`}
                    type="time"
                    value={row.opensAt}
                    disabled={!canEdit}
                    onChange={(event) => patch(row.dayOfWeek, { opensAt: event.target.value })}
                    className="rounded-field bg-surface-container-lowest px-3 py-2 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring"
                  />
                  <span className="text-on-surface-variant">to</span>
                  <label className="sr-only" htmlFor={`closes-${row.dayOfWeek}`}>
                    {row.name} closes at
                  </label>
                  <input
                    id={`closes-${row.dayOfWeek}`}
                    type="time"
                    value={row.closesAt}
                    disabled={!canEdit}
                    onChange={(event) => patch(row.dayOfWeek, { closesAt: event.target.value })}
                    className="rounded-field bg-surface-container-lowest px-3 py-2 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring"
                  />
                </span>

                {/* A kitchen that shuts at 2am closes on tomorrow's clock. The
                    tick is what says which midnight the time belongs to. */}
                <label className="flex cursor-pointer items-center gap-2 text-label-bold font-normal text-on-surface-variant">
                  <input
                    type="checkbox"
                    checked={row.overnight}
                    disabled={!canEdit}
                    onChange={(event) => patch(row.dayOfWeek, { overnight: event.target.checked })}
                    className="size-4 accent-primary"
                  />
                  past midnight
                </label>

                {canEdit && row.dayOfWeek < 6 ? (
                  <button
                    type="button"
                    onClick={() => copyDown(row)}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-field px-3 py-1.5 text-label-bold text-primary hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <Copy aria-hidden="true" className="size-4" />
                    Copy to the rest
                  </button>
                ) : null}
              </>
            ) : (
              <span className="text-body-md text-on-surface-variant">Closed</span>
            )}

            {errors[row.dayOfWeek] ? (
              <p role="alert" className="w-full text-label-bold text-error">
                {errors[row.dayOfWeek]}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {pending ? "Saving…" : "Save the week"}
          </button>
          <p className="text-label-bold font-normal text-on-surface-variant">
            Read in {timezone}. This replaces the whole week.
          </p>
        </div>
      ) : null}
    </form>
  );
}
