"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { lastMonth, monthToDate } from "@/lib/finance";

/**
 * Picking what a statement covers.
 *
 * A plain form that navigates, rather than fetching: the statement is server
 * rendered, so the URL is the state. That makes a particular month's figures
 * something you can send to the accountant as a link, and makes the back
 * button work the way everyone expects it to.
 *
 * The quick ranges are there because "last month" is what almost every run of
 * these reports actually wants, and typing two dates to get it is friction
 * that leads to people reading whatever range was left over from last time.
 */
export default function ReportControls({ report, branches, value, showFrom = true, showAsOf = false }) {
  const router = useRouter();
  const params = useSearchParams();
  const [form, setForm] = useState(value);

  function go(next) {
    const query = new URLSearchParams(params.toString());
    for (const [key, item] of Object.entries(next)) {
      if (item) query.set(key, item);
      else query.delete(key);
    }
    query.delete("report");
    router.push(`/dashboard/financial-reports/${report}?${query.toString()}`);
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5"
      onSubmit={(event) => {
        event.preventDefault();
        go(form);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {showFrom ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="report-from" className="text-label-bold text-on-surface">
              From
            </label>
            <input
              id="report-from"
              type="date"
              value={form.from ?? ""}
              onChange={(event) => setForm((state) => ({ ...state, from: event.target.value }))}
              className="min-h-11 rounded-field bg-surface-container-high px-4 text-body-md text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="report-to" className="text-label-bold text-on-surface">
            {showAsOf ? "As at" : "To"}
          </label>
          <input
            id="report-to"
            type="date"
            value={form.to ?? ""}
            onChange={(event) => setForm((state) => ({ ...state, to: event.target.value }))}
            className="min-h-11 rounded-field bg-surface-container-high px-4 text-body-md text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </div>

        {branches.length > 1 ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="report-branch" className="text-label-bold text-on-surface">
              Branch
            </label>
            <select
              id="report-branch"
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

        <div className="flex items-end">
          <button
            type="submit"
            className="min-h-11 w-full rounded-field bg-primary-container px-5 text-label-bold text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Run it
          </button>
        </div>
      </div>

      {showFrom ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              const range = lastMonth();
              setForm((state) => ({ ...state, ...range }));
              go({ ...form, ...range });
            }}
            className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Last month
          </button>
          <button
            type="button"
            onClick={() => {
              const range = monthToDate();
              setForm((state) => ({ ...state, ...range }));
              go({ ...form, ...range });
            }}
            className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            This month so far
          </button>
        </div>
      ) : null}
    </form>
  );
}
