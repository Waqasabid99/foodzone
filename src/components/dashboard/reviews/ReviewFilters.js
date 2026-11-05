"use client";

import { useRef } from "react";
import { Search } from "lucide-react";

/** Branch, rating and words, held in the URL. The status tabs are links. */
export default function ReviewFilters({ q = "", branch = "", rating = "", status = "", branches = [] }) {
  const form = useRef(null);
  const submit = () => form.current?.requestSubmit();
  const control =
    "w-full rounded-field border border-transparent bg-surface-container-low px-3 py-2.5 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring";

  return (
    <form ref={form} method="get" className="flex flex-wrap items-end gap-3 rounded-card bg-surface-container-lowest p-4">
      {/* The tab you are on is part of the query, so searching stays in it. */}
      {status ? <input type="hidden" name="status" value={status} /> : null}

      <div className="flex min-w-56 flex-[2] flex-col gap-1.5">
        <label htmlFor="review-search" className="text-label-bold text-on-surface">Search</label>
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-on-surface-variant" />
          <input id="review-search" name="q" type="search" defaultValue={q} placeholder="Words, customer or product" className={`${control} pl-9`} />
        </div>
      </div>

      {branches.length > 1 ? (
        <div className="flex min-w-44 flex-1 flex-col gap-1.5">
          <label htmlFor="review-branch" className="text-label-bold text-on-surface">Branch</label>
          <select id="review-branch" name="branch" defaultValue={branch} onChange={submit} className={control}>
            <option value="">Every branch</option>
            {branches.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="flex min-w-36 flex-1 flex-col gap-1.5">
        <label htmlFor="review-rating" className="text-label-bold text-on-surface">Rating</label>
        <select id="review-rating" name="rating" defaultValue={rating} onChange={submit} className={control}>
          <option value="">Any rating</option>
          {[5, 4, 3, 2, 1].map((value) => (
            <option key={value} value={value}>{value} star{value === 1 ? "" : "s"}</option>
          ))}
        </select>
      </div>

      <button type="submit" className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        Search
      </button>
    </form>
  );
}
