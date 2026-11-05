"use client";

import { useRef } from "react";
import { Search } from "lucide-react";

const STATUS_OPTIONS = [
  { value: "all", label: "All branches" },
  { value: "active", label: "Active only" },
  { value: "inactive", label: "Inactive only" },
];

/**
 * Search and status, kept in the URL.
 *
 * A real GET `<form>` rather than an onChange fetch, for three reasons: the
 * filtered list is a shareable, bookmarkable URL; it works before the JavaScript
 * for this page has loaded, which on a till or a back-office laptop is not a
 * hypothetical; and the server is already reading `searchParams`, so there is
 * no second code path to keep in step.
 *
 * Submitting always drops `cursor` — it belongs to the previous query, and
 * carrying it forward would open the new filter on page three of the old one.
 */
export default function BranchFilters({ q = "", status = "all" }) {
  const form = useRef(null);

  return (
    <form
      ref={form}
      method="get"
      className="flex flex-wrap items-end gap-3 rounded-card bg-surface-container-lowest p-4"
    >
      <div className="flex min-w-56 flex-1 flex-col gap-1.5">
        <label htmlFor="branch-search" className="text-label-bold text-on-surface">
          Search
        </label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-on-surface-variant"
          />
          <input
            id="branch-search"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Name, code or city"
            className="w-full rounded-field border border-transparent bg-surface-container-low py-2.5 pl-9 pr-3 text-body-md text-on-surface placeholder:text-on-surface-variant/70 focus:outline-2 focus:outline-offset-2 focus:outline-ring"
          />
        </div>
      </div>

      <div className="flex min-w-40 flex-col gap-1.5">
        <label htmlFor="branch-status" className="text-label-bold text-on-surface">
          Status
        </label>
        <select
          id="branch-status"
          name="status"
          defaultValue={status}
          // With JavaScript the select applies itself, which is what people
          // expect of a dropdown; without it the button below still works.
          onChange={() => form.current?.requestSubmit()}
          className="rounded-field border border-transparent bg-surface-container-low px-3 py-2.5 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Apply
      </button>
    </form>
  );
}
