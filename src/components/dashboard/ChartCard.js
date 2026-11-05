"use client";

import { useState } from "react";
import { Table2, ChartColumn } from "lucide-react";

/**
 * The frame every chart on the dashboard sits in.
 *
 * It owns the one piece of accessibility a chart cannot provide for itself: the
 * same numbers as a table. A chart encodes values as geometry, and geometry is
 * unreadable to a screen reader and hard for anyone who needs the exact figure
 * rather than the shape. The toggle is not a fallback for a broken chart — it
 * is the other half of the same answer, and it is one click away rather than
 * buried.
 */
export default function ChartCard({ title, subtitle = null, columns, rows, children }) {
  const [asTable, setAsTable] = useState(false);

  return (
    <section className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-headline-md text-on-surface">{title}</h2>
          {subtitle ? <p className="mt-1 text-body-md text-on-surface-variant">{subtitle}</p> : null}
        </div>

        <button
          type="button"
          onClick={() => setAsTable((value) => !value)}
          aria-pressed={asTable}
          className="flex shrink-0 items-center gap-2 rounded-full bg-surface-container-high px-4 py-2 text-label-bold text-on-surface transition-colors hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {asTable ? <ChartColumn aria-hidden="true" className="size-4" /> : <Table2 aria-hidden="true" className="size-4" />}
          {asTable ? "Chart" : "Table"}
        </button>
      </div>

      {asTable ? (
        // The table scrolls inside its own box rather than widening the page.
        <div className="overflow-x-auto">
          <table className="w-full min-w-96 text-body-md">
            <thead>
              <tr className="border-b border-outline-variant text-left">
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={`pb-2 text-label-bold text-on-surface-variant ${column.align === "right" ? "text-right" : ""}`}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="py-4 text-on-surface-variant">
                    Nothing to show yet.
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => (
                  <tr key={row.key ?? index} className="border-b border-outline-variant/50 last:border-0">
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={`py-2 text-on-surface ${column.align === "right" ? "text-right tabular-nums" : ""}`}
                      >
                        {row[column.key]}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  );
}
