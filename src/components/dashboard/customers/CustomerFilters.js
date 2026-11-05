"use client";

import { useRef } from "react";
import { Search } from "lucide-react";
import { CUSTOMER_KINDS } from "@/lib/customer-form";

/** Search and kind, held in the URL like the other list filters. */
export default function CustomerFilters({ q = "", kind = "" }) {
  const form = useRef(null);
  const control =
    "w-full rounded-field border border-transparent bg-surface-container-low px-3 py-2.5 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring";

  return (
    <form ref={form} method="get" className="flex flex-wrap items-end gap-3 rounded-card bg-surface-container-lowest p-4">
      <div className="flex min-w-56 flex-[2] flex-col gap-1.5">
        <label htmlFor="customer-search" className="text-label-bold text-on-surface">Search</label>
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-on-surface-variant" />
          <input id="customer-search" name="q" type="search" defaultValue={q} placeholder="Name, email or phone" className={`${control} pl-9`} />
        </div>
      </div>

      <div className="flex min-w-44 flex-1 flex-col gap-1.5">
        <label htmlFor="customer-kind" className="text-label-bold text-on-surface">Show</label>
        <select id="customer-kind" name="kind" defaultValue={kind} onChange={() => form.current?.requestSubmit()} className={control}>
          {CUSTOMER_KINDS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      <button type="submit" className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        Search
      </button>
    </form>
  );
}
