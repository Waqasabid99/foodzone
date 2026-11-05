"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { GROUPINGS, lastMonth, lastWeek, monthToDate } from "@/lib/insights";

/**
 * What a report covers: the dates, the branch, and how a series is bucketed.
 *
 * A plain form that navigates rather than fetching. The report is server
 * rendered, so the URL *is* the state — which makes a particular week's
 * figures something you can send to somebody as a link, and makes the back
 * button behave the way everyone already expects.
 *
 * The quick ranges are not a convenience. Without them people read whatever
 * range happened to be left in the box, and a report of the wrong fortnight
 * is indistinguishable from a report of the right one.
 */
export default function RangeControls({ basePath, branches, value, showDates = true, showGrouping = false }) {
  const router = useRouter();
  const params = useSearchParams();
  const [form, setForm] = useState(value);

  function go(next) {
    const query = new URLSearchParams(params.toString());
    for (const [key, item] of Object.entries(next)) {
      if (item) query.set(key, item);
      else query.delete(key);
    }
    const text = query.toString();
    router.push(text ? `${basePath}?${text}` : basePath);
  }

  const quick = (range) => {
    setForm((state) => ({ ...state, ...range }));
    go({ ...form, ...range });
  };

  return (
    <form
      className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5"
      onSubmit={(event) => {
        event.preventDefault();
        go(form);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {showDates ? (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="range-from" className="text-label-bold text-on-surface">
                From
              </label>
              <input
                id="range-from"
                type="date"
                value={form.from ?? ""}
                onChange={(event) => setForm((state) => ({ ...state, from: event.target.value }))}
                className="min-h-11 rounded-field bg-surface-container-high px-4 text-body-md text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="range-to" className="text-label-bold text-on-surface">
                To
              </label>
              <input
                id="range-to"
                type="date"
                value={form.to ?? ""}
                onChange={(event) => setForm((state) => ({ ...state, to: event.target.value }))}
                className="min-h-11 rounded-field bg-surface-container-high px-4 text-body-md text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
            </div>
          </>
        ) : null}

        {branches.length > 1 ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="range-branch" className="text-label-bold text-on-surface">
              Branch
            </label>
            <select
              id="range-branch"
              value={form.branch ?? ""}
              onChange={(event) => setForm((state) => ({ ...state, branch: event.target.value }))}
              className="min-h-11 rounded-field bg-surface-container-high px-4 text-body-md text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <option value="">Everything I can see</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {showGrouping ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="range-group" className="text-label-bold text-on-surface">
              Bucket
            </label>
            <select
              id="range-group"
              value={form.groupBy ?? "day"}
              onChange={(event) => setForm((state) => ({ ...state, groupBy: event.target.value }))}
              className="min-h-11 rounded-field bg-surface-container-high px-4 text-body-md text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {GROUPINGS.map((row) => (
                <option key={row.value} value={row.value}>
                  {row.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="flex items-end">
          <button
            type="submit"
            className="min-h-11 w-full rounded-field bg-primary-container px-5 text-label-bold text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Run it
          </button>
        </div>
      </div>

      {showDates ? (
        <div className="flex flex-wrap gap-2">
          {[
            ["Last 7 days", lastWeek],
            ["Last month", lastMonth],
            ["This month so far", monthToDate],
          ].map(([label, make]) => (
            <button
              key={label}
              type="button"
              onClick={() => quick(make())}
              className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </form>
  );
}
