"use client";

import { useRef } from "react";
import { Search } from "lucide-react";
import { PRODUCT_STATUSES } from "@/lib/product-form";

/**
 * Search, category and status, held in the URL.
 *
 * The same GET-form approach as the branch list: shareable, works before
 * JavaScript loads, and submitting drops the cursor that belonged to the
 * previous query.
 */
export default function ProductFilters({ q = "", category = "", status = "all", station = "", categories = [] }) {
  const form = useRef(null);
  const submit = () => form.current?.requestSubmit();

  const control =
    "w-full rounded-field border border-outline bg-surface-container-low px-3 py-2.5 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring";

  return (
    <form ref={form} method="get" className="flex flex-wrap items-end gap-3 rounded-card bg-surface-container-lowest p-4">
      {/* Kept across searches; cleared from the chip above the table. */}
      {station ? <input type="hidden" name="station" value={station} /> : null}
      <div className="flex min-w-56 flex-[2] flex-col gap-1.5">
        <label htmlFor="product-search" className="text-label-bold text-on-surface">
          Search
        </label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-on-surface-variant"
          />
          <input
            id="product-search"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Name, description or SKU"
            className={`${control} pl-9`}
          />
        </div>
      </div>

      <div className="flex min-w-44 flex-1 flex-col gap-1.5">
        <label htmlFor="product-category" className="text-label-bold text-on-surface">
          Category
        </label>
        <select id="product-category" name="category" defaultValue={category} onChange={submit} className={control}>
          <option value="">All categories</option>
          {categories.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-w-40 flex-1 flex-col gap-1.5">
        <label htmlFor="product-status" className="text-label-bold text-on-surface">
          Status
        </label>
        <select id="product-status" name="status" defaultValue={status} onChange={submit} className={control}>
          {PRODUCT_STATUSES.map((option) => (
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
