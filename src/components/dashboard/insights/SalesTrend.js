"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/format";
import { bucketLabel } from "@/lib/insights";

/**
 * Revenue over a window, bucketed by hour, day or month.
 *
 * Separate from the overview's `RevenueTrend` on purpose rather than by
 * accident: that one plots days and only days, and giving it three
 * granularities would mean its axis formatter had to guess which it was
 * holding. Here the bucket key carries its own granularity — `2026-10`,
 * `2026-10-03`, `2026-10-03T14` — so the labels are read off the data
 * instead of being passed alongside it and drifting out of step.
 *
 * One series, so no legend: the heading names what is plotted, and a legend
 * for a single series is a key to a lock with one key. One hue, because the
 * value is a magnitude and magnitude is carried by the geometry.
 */
export default function SalesTrend({ data, currency, height = 260 }) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="sales-trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-data)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--chart-data)" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          {/* Horizontal only: nobody reads a date by tracing upward from a
              vertical rule, they read the label. */}
          <CartesianGrid stroke="var(--outline-variant)" strokeDasharray="3 3" vertical={false} />

          <XAxis
            dataKey="period"
            tickFormatter={(value) => bucketLabel(value)}
            tick={{ fill: "var(--on-surface-variant)", fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: "var(--outline-variant)" }}
            minTickGap={16}
          />
          <YAxis
            tickFormatter={compact}
            tick={{ fill: "var(--on-surface-variant)", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={52}
          />

          <Tooltip
            cursor={{ stroke: "var(--outline)", strokeWidth: 1 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="rounded-field border border-outline-variant bg-surface-container-lowest px-3 py-2 shadow-e2">
                  <p className="text-label-bold text-on-surface">{bucketLabel(label, { long: true })}</p>
                  <p className="text-body-md text-on-surface-variant">
                    {formatMoney(payload[0].value, currency)} · {payload[0].payload.orders}{" "}
                    {payload[0].payload.orders === 1 ? "order" : "orders"}
                  </p>
                </div>
              ) : null
            }
          />

          <Area
            type="monotone"
            dataKey="revenue"
            stroke="var(--chart-data)"
            strokeWidth={2}
            fill="url(#sales-trend-fill)"
            dot={false}
            activeDot={{ r: 4, fill: "var(--chart-data)", stroke: "var(--surface-container-lowest)", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Axis ticks are for scale; the exact figure is in the tooltip and the table. */
function compact(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}
