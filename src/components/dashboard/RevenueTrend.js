"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney } from "@/lib/format";

/**
 * Revenue per day.
 *
 * An area chart with **one** series, so there is no legend: the heading names
 * the thing being plotted, and a legend box for a single series is a key to a
 * lock with one key. The fill is the chart hue at low opacity over a 2px
 * stroke — the stroke is what the eye reads, the fill only ties it to the
 * baseline.
 *
 * The grid is horizontal only and recessive. Vertical gridlines on a time axis
 * add ink without adding an answer: nobody reads a date by tracing upward from
 * one, they read the label.
 */
export default function RevenueTrend({ data, currency }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-data)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--chart-data)" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="var(--outline-variant)" strokeDasharray="3 3" vertical={false} />

          <XAxis
            dataKey="date"
            tickFormatter={shortDay}
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

          {/* An HTML chart is interactive; a reader who wants the exact figure
              for a day should not have to switch to the table to get it. */}
          <Tooltip
            cursor={{ stroke: "var(--outline)", strokeWidth: 1 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="rounded-field border border-outline-variant bg-surface-container-lowest px-3 py-2 shadow-e2">
                  <p className="text-label-bold text-on-surface">{longDay(label)}</p>
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
            fill="url(#revenue-fill)"
            // Dots on every point turn a fortnight into a beaded string; the
            // hovered one is the only one worth drawing.
            dot={false}
            activeDot={{ r: 4, fill: "var(--chart-data)", stroke: "var(--surface-container-lowest)", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function shortDay(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

function longDay(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** Axis ticks are for scale, not for precision — the tooltip has the exact figure. */
function compact(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}
