"use client";

import { formatMoney } from "@/lib/format";
import { parseTip, tipPresets } from "@/lib/checkout";

/**
 * An optional tip.
 *
 * Deliberately starts at zero with no preset highlighted as the "suggested"
 * one. A tip is the one amount on this page the customer genuinely chooses, and
 * pre-selecting 15% collects money from people who did not notice rather than
 * from people who decided.
 *
 * The amount is still re-quoted by the server before it is charged; this
 * control only decides what to ask for.
 */
export default function TipPicker({ subtotal, currency, value, custom, onChange, onCustomChange, label }) {
  const presets = tipPresets(subtotal);
  const customInvalid = custom !== "" && parseTip(custom) === null;

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-label-bold text-on-surface">{label}</legend>

      <div className="flex flex-wrap gap-2">
        {presets.map(({ percent, amount }) => {
          // A custom amount that happens to equal a preset should light that
          // preset up, so the control never shows two answers at once.
          const active = custom === "" && value === amount;
          return (
            <button
              key={percent}
              type="button"
              onClick={() => {
                onCustomChange("");
                onChange(amount);
              }}
              aria-pressed={active}
              className={`rounded-full px-5 py-2.5 text-label-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                active
                  ? "bg-primary-container text-on-primary-container"
                  : "bg-surface-container-low text-on-surface hover:bg-surface-container-high"
              }`}
            >
              {percent === 0 ? "No tip" : `${percent}%`}
              {percent > 0 ? (
                <span className="ml-2 font-normal opacity-80">{formatMoney(amount, currency)}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="tip-custom" className="sr-only">
          Custom tip amount
        </label>
        <input
          id="tip-custom"
          inputMode="decimal"
          value={custom}
          onChange={(event) => {
            const next = event.target.value;
            onCustomChange(next);
            // The typed value is kept on screen even when it is not a number
            // the server would accept; only a valid one is adopted as the tip.
            const parsed = parseTip(next);
            if (parsed !== null) onChange(parsed);
          }}
          placeholder={`Other amount (${currency})`}
          aria-invalid={customInvalid ? "true" : undefined}
          aria-describedby={customInvalid ? "tip-custom-error" : undefined}
          className={`w-full rounded-field bg-surface-container-low px-4 py-3 text-body-md text-on-surface placeholder:text-on-surface-variant/70 focus:outline-2 focus:outline-offset-2 focus:outline-ring sm:max-w-56 ${
            customInvalid ? "border border-error" : "border border-outline"
          }`}
        />
        {customInvalid ? (
          <p id="tip-custom-error" className="text-label-bold text-error">
            Enter a tip as a plain number.
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}
