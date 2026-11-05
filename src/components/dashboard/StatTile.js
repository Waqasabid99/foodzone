import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

/**
 * One headline number.
 *
 * A tile rather than a one-bar chart: a single current value has no magnitudes
 * to compare, and drawing it as a bar asks the reader to decode a length that
 * encodes nothing.
 *
 * The delta is the part worth being careful with. It is rendered only when the
 * comparison is honest — `note` explains what it is against — and it never
 * relies on colour alone: an arrow carries the direction for anyone who cannot
 * separate the green from the red, and the sign is in the text.
 */
/**
 * The figure's size, from the tile's width and the figure's length together.
 *
 * Neither alone is enough: "Today" overflows a narrow tile and "PKR 1,740,500"
 * overflows a wide one. The tile is a size container, so `cqi` is its own
 * width, and dividing that by the character count (at roughly 0.7em per bold
 * glyph) gives the largest size that fits on one line — capped at the headline
 * size, and never below body text.
 */
function valueStyle(value) {
  const characters = Math.max(String(value ?? "").length, 3);
  return { fontSize: `clamp(1rem, calc(100cqi / ${(characters * 0.7).toFixed(2)}), 2.5rem)` };
}

export default function StatTile({ label, value, note = null, delta = null, tone = "neutral" }) {
  const Icon = delta == null ? null : delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : Minus;

  // "Up" is not automatically good — waste rising is bad — so the caller says
  // which direction is favourable rather than the component assuming.
  const deltaTone =
    delta == null || delta === 0
      ? "text-on-surface-variant"
      : (delta > 0) === (tone !== "inverse")
        ? "text-success"
        : "text-error";

  return (
    <div className="@container flex min-w-0 flex-col gap-1 rounded-card bg-surface-container-lowest p-5">
      <p className="text-label-bold uppercase tracking-wide text-on-surface-variant">{label}</p>

      {/* Shrinks to fit rather than wrapping or clipping: a total split across
          two lines reads as two numbers, and a cut-off one is wrong. */}
      <p className="whitespace-nowrap font-display text-headline-lg text-on-surface tabular-nums" style={valueStyle(value)}>
        {value}
      </p>

      {delta != null ? (
        <p className={`flex items-center gap-1 text-label-bold ${deltaTone}`}>
          <Icon aria-hidden="true" className="size-4" />
          {delta > 0 ? "+" : ""}
          {delta}%
          {note ? <span className="font-normal text-on-surface-variant"> {note}</span> : null}
        </p>
      ) : note ? (
        <p className="text-label-bold font-normal text-on-surface-variant">{note}</p>
      ) : null}
    </div>
  );
}
