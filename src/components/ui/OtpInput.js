"use client";

import { useId, useRef } from "react";
import { describedBy } from "@/lib/form-errors";
import {
  toDigits,
  withDigitAt,
  withBackspaceAt,
  digitsFromPaste,
  firstEmptyIndex,
} from "@/lib/otp";

/**
 * A one-time-code field, drawn as one box per digit.
 *
 * The boxes are presentation. Underneath it behaves as a single value, which is
 * what makes the rest of it tractable:
 *
 *   - Pasting the code anywhere in the group fills the whole thing. People
 *     copy the code out of the email — that is the normal path, not the edge
 *     case, and a field that accepts only one character of a pasted six is the
 *     single most common way these are broken.
 *   - Focus is pulled back to the first empty box, so the value can never end
 *     up with a hole in the middle of it.
 *   - Backspace in an empty box steps back and clears the one before, which is
 *     what the key is expected to do when each box holds one character.
 *
 * Accessibility: the group carries the label, and each box is named "Digit 3 of
 * 6" rather than left nameless. Without that a screen reader announces six
 * unlabelled text fields and the reader has no way to tell where they are.
 *
 * `length` is not hardcoded to six. The server generates `OTP_LENGTH` digits
 * and that is configurable between 4 and 10, so the number of boxes is told to
 * this component rather than assumed by it — otherwise raising the setting
 * produces a form that cannot express a valid code.
 */
export default function OtpInput({
  value = "",
  onChange,
  length = 6,
  label,
  error = null,
  disabled = false,
  autoFocus = false,
}) {
  const groupId = useId();
  const labelId = `${groupId}-label`;
  const errorId = error ? `${groupId}-error` : null;
  const inputsRef = useRef([]);

  const digits = toDigits(value, length);
  const firstEmpty = value.length < length ? firstEmptyIndex(value, length) : -1;

  const focusAt = (index) => {
    const clamped = Math.max(0, Math.min(length - 1, index));
    inputsRef.current[clamped]?.focus();
    inputsRef.current[clamped]?.select();
  };

  function handleChange(index, raw) {
    const next = withDigitAt(value, length, index, raw);
    if (next === value) return;

    onChange(next);
    if (index < length - 1) focusAt(index + 1);
  }

  function handleKeyDown(index, event) {
    if (event.key === "Backspace") {
      event.preventDefault();
      const { value: next, focusIndex } = withBackspaceAt(value, length, index);
      onChange(next);
      if (focusIndex !== index) focusAt(focusIndex);
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusAt(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      focusAt(index + 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusAt(length - 1);
    }
  }

  function handlePaste(event) {
    const pasted = digitsFromPaste(event.clipboardData.getData("text"), length);
    if (!pasted) return;

    event.preventDefault();
    onChange(pasted);
    focusAt(Math.min(pasted.length, length - 1));
  }

  function handleFocus(index) {
    // Keeps the value dense: clicking the fourth box while the first is empty
    // would otherwise strand a gap that no amount of typing can fill.
    if (firstEmpty !== -1 && index > firstEmpty) focusAt(firstEmpty);
  }

  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-label-bold uppercase tracking-wide text-on-surface-variant">
        {label}
      </span>

      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={describedBy(errorId)}
        className="flex gap-2 sm:gap-3"
      >
        {digits.map((digit, index) => (
          <input
            // The boxes are fixed positions in a single field, not a reorderable
            // list, so the index is the stable identity here.
            key={index}
            ref={(node) => {
              inputsRef.current[index] = node;
            }}
            type="text"
            // `inputMode` over `type="number"`: a numeric keypad without the
            // spinner, the scroll-wheel surprise, or a dropped leading zero.
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            value={digit}
            disabled={disabled}
            autoFocus={autoFocus && index === 0}
            // Only the first box claims it, or the browser offers to autofill
            // the same code into all six.
            autoComplete={index === 0 ? "one-time-code" : "off"}
            aria-label={`Digit ${index + 1} of ${length}`}
            aria-invalid={error ? "true" : undefined}
            onChange={(event) => handleChange(index, event.target.value)}
            onKeyDown={(event) => handleKeyDown(index, event)}
            onPaste={handlePaste}
            onFocus={() => handleFocus(index)}
            className={`size-12 rounded-field border-2 bg-surface-container-low text-center font-display text-headline-md text-on-surface transition-colors focus:outline-2 focus:outline-offset-2 focus:outline-ring disabled:cursor-not-allowed disabled:opacity-60 sm:size-14 ${
              error ? "border-error" : digit ? "border-primary-container" : "border-transparent"
            }`}
          />
        ))}
      </div>

      {error ? (
        <p id={errorId} className="text-label-bold text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
