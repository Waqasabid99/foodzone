"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/format";

/**
 * A magnitude comparison across a handful of named things.
 *
 * Horizontal, because the names are words — "Dine in", "The Volcano Double" —
 * and a vertical bar chart either truncates them or turns them on their side.
 *
 * **One hue for every bar.** Magnitude is already carried by the length of the
 * bar; colouring each one differently would imply the colours mean something
 * and spend a categorical palette on nothing. The exception is a bar at zero,
 * which gets a faint track so "no pickup orders today" reads as a measured
 * zero rather than a missing row.
 *
 * `format` exists because not everything plotted here is money. A count of
 * deliveries rendered as "PKR 41" is not a styling slip, it is a wrong
 * statement about what the bar means.
 */
export default function BarBreakdown({ data, currency, height = 220, format = null }) {
  const show = format ?? ((value) => formatMoney(value, currency));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--outline-variant)" strokeDasharray="3 3" horizontal={false} />

          <XAxis
            type="number"
            tick={{ fill: "var(--on-surface-variant)", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => (value >= 1000 ? `${Math.round(value / 1000)}k` : value)}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={<CategoryTick />}
            tickLine={false}
            axisLine={false}
            width={136}
          />

          <Tooltip
            cursor={{ fill: "var(--surface-container)" }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="rounded-field border border-outline-variant bg-surface-container-lowest px-3 py-2 shadow-e2">
                  <p className="text-label-bold text-on-surface">{payload[0].payload.label}</p>
                  <p className="text-body-md text-on-surface-variant">
                    {show(payload[0].value)}
                    {payload[0].payload.meta ? ` · ${payload[0].payload.meta}` : ""}
                  </p>
                </div>
              ) : null
            }
          />

          {/* 4px rounded ends on the data end only, anchored flat to the axis. */}
          <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={18} isAnimationActive={false}>
            {data.map((row) => (
              <Cell
                key={row.label}
                fill={row.value > 0 ? "var(--chart-data)" : "var(--outline-variant)"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * A category label, on one line.
 *
 * Recharts wraps a long tick onto a second line by default, which splits
 * "The Volcano Double" into "The Volcano" / "Double" and leaves the two halves
 * reading as separate rows. A product name is a name — it is better clipped
 * with an ellipsis than broken in half — and the full text is a hover and a
 * table-toggle away.
 */
function CategoryTick({ x, y, payload }) {
  const label = String(payload?.value ?? "");
  const clipped = label.length > 18 ? `${label.slice(0, 17)}…` : label;

  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor="end"
      fill="var(--on-surface)"
      fontSize={12}
    >
      <title>{label}</title>
      {clipped}
    </text>
  );
}
