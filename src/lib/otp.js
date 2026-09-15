/**
 * The value transformations behind a one-time-code field.
 *
 * Pulled out of the component because this is where the bugs in these live —
 * an off-by-one in backspace, a paste that keeps the wrong end of the string,
 * a "replace the digit already in this box" that appends instead. None of that
 * needs a DOM to be wrong, so none of it needs a DOM to be tested.
 *
 * Every function takes and returns the code as a plain string, shorter than
 * `length` when incomplete. The caller renders it as boxes.
 */

/** The code as one slot per box, "" for the empty ones. */
export function toDigits(value, length) {
  return Array.from({ length }, (_, index) => value[index] ?? "");
}

/** Drops the empty slots back down to a dense string. */
export function fromDigits(digits) {
  return digits.join("").replace(/\s/g, "");
}

/**
 * Types `raw` into the box at `index`.
 *
 * Only the last digit of `raw` is taken, so a keystroke into a box that is
 * already filled replaces its contents rather than being swallowed. Returns
 * the value unchanged when `raw` holds nothing usable.
 */
export function withDigitAt(value, length, index, raw) {
  const digit = String(raw).replace(/\D/g, "").slice(-1);
  if (!digit) return value;

  const digits = toDigits(value, length);
  digits[index] = digit;
  return fromDigits(digits);
}

/**
 * Backspace at `index`.
 *
 * Clears the box if it holds something; otherwise clears the one before it,
 * which is what the key is expected to do when each box holds one character.
 * Returns the new value and where focus should land.
 */
export function withBackspaceAt(value, length, index) {
  const digits = toDigits(value, length);

  if (digits[index]) {
    digits[index] = "";
    return { value: fromDigits(digits), focusIndex: index };
  }

  if (index > 0) {
    digits[index - 1] = "";
    return { value: fromDigits(digits), focusIndex: index - 1 };
  }

  return { value: fromDigits(digits), focusIndex: 0 };
}

/**
 * Digits lifted out of pasted text.
 *
 * Non-digits are stripped rather than rejected, so a code copied with
 * surrounding words, a space in the middle, or a trailing newline still works
 * — which is how it arrives when it is copied out of an email.
 */
export function digitsFromPaste(text, length) {
  return String(text ?? "").replace(/\D/g, "").slice(0, length);
}

/** The box focus belongs in: the first empty one, or the last if it is full. */
export function firstEmptyIndex(value, length) {
  const digits = toDigits(value, length);
  const index = digits.findIndex((digit) => digit === "");
  return index === -1 ? length - 1 : index;
}
