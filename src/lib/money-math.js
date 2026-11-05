import { roundDecimalString } from "@/lib/inventory";

/**
 * Exact decimal arithmetic on the strings a form holds.
 *
 * Floats are not used, even for a preview. `0.1 + 0.2` is the classic example,
 * but the ones that matter here are quieter: a twenty-line order priced in
 * floats shows a grand total a rupee away from the one the server derives with
 * real decimals, and a cashier counting change from a float can hand back the
 * wrong coin. The server is still authoritative — this only agrees with it.
 *
 * Everything works on digit strings lifted to a common scale, so nothing is
 * ever a binary fraction. Shared by purchasing and the front desk, because the
 * second implementation of money arithmetic is the one that disagrees.
 */

export function scaled(input) {
  const text = String(input ?? "").trim().replace(/,/g, "");
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const digits = BigInt((whole || "0") + fraction);
  return { digits: negative ? -digits : digits, scale: fraction.length };
}

/** Both operands lifted to the same scale, so they can be added. */
export function align(a, b) {
  const scale = Math.max(a.scale, b.scale);
  const lift = (value) => ({ digits: value.digits * 10n ** BigInt(scale - value.scale), scale });
  return [lift(a), lift(b), scale];
}

export const ZERO = { digits: 0n, scale: 0 };

export const add = (a, b) => {
  const [x, y, scale] = align(a, b);
  return { digits: x.digits + y.digits, scale };
};
export const subtract = (a, b) => add(a, { digits: -b.digits, scale: b.scale });
export const multiply = (a, b) => ({ digits: a.digits * b.digits, scale: a.scale + b.scale });
export const atLeastZero = (a) => (a.digits < 0n ? ZERO : a);

/** -1, 0 or 1, whatever scales the two were written at. */
export function compare(a, b) {
  const [x, y] = align(a, b);
  return x.digits < y.digits ? -1 : x.digits > y.digits ? 1 : 0;
}

/** A percentage of an amount. Two extra decimal places *is* the divide by 100. */
export const percentOf = (amount, rate) => multiply(amount, { digits: rate.digits, scale: rate.scale + 2 });

/** Back to a plain decimal string, rounded half away from zero. */
export function unscale(value, places = 2) {
  const negative = value.digits < 0n;
  const digits = (negative ? -value.digits : value.digits).toString().padStart(value.scale + 1, "0");
  const whole = digits.slice(0, digits.length - value.scale) || "0";
  const fraction = value.scale ? digits.slice(digits.length - value.scale) : "";
  return roundDecimalString(`${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`, places);
}

export const decimal = (input) => scaled(input) ?? ZERO;

/** Several typed amounts added up exactly, as a 2-decimal string. */
export const addAmounts = (...values) => unscale(values.reduce((total, value) => add(total, decimal(value)), ZERO));

/** `a - b`, never below zero, as a 2-decimal string. For "what is still owed". */
export const difference = (a, b) => unscale(atLeastZero(subtract(decimal(a), decimal(b))));

/**
 * `a - b`, signed, as a 2-decimal string.
 *
 * Separate from `difference` on purpose. Clamping at zero is right for "what
 * is still owed on this bill" and wrong for a balance that can genuinely go
 * the other way — a driver holding more of the restaurant's cash than they
 * earned owes money, and showing that as zero hides a debt.
 */
export const minusAmounts = (a, b) => unscale(subtract(decimal(a), decimal(b)));

/** Whether two typed amounts are the same money, whatever they look like. */
export const sameAmount = (a, b) => compare(decimal(a), decimal(b)) === 0;

/** True when `a` is strictly more than `b`. */
export const exceeds = (a, b) => compare(decimal(a), decimal(b)) > 0;

/**
 * Whether a JavaScript number fits a Decimal(_, places) column.
 *
 * Not `Number.isInteger(value * 10_000)`. That multiplication is itself a
 * float operation, and it is wrong for about one ordinary two-decimal price in
 * nine: `0.07 * 10000` is 699.9999999999999, so a 7-paisa price is rejected as
 * having too many decimals. `Math.round` around it does not rescue the check —
 * it makes it pass for every input, which is a validator that validates
 * nothing.
 *
 * The shortest round-trip string is the honest answer, because it is what the
 * client typed: `String(2499.99)` is `"2499.99"`, never `"2499.990000000001"`.
 * Counting the digits after the point asks the question directly instead of
 * inferring it from a binary fraction.
 */
export function fitsScale(value, places = 4) {
  if (!Number.isFinite(value)) return false;
  const text = String(value);
  const exponent = text.indexOf("e");
  if (exponent !== -1) {
    // Exponential form means a magnitude no price column holds, or a value so
    // small it is below the column's last digit either way. Only a whole
    // number can honestly survive that round trip.
    return Number.isInteger(value);
  }
  const point = text.indexOf(".");
  return point === -1 || text.length - point - 1 <= places;
}
