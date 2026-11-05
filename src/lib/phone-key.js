/**
 * The comparable form of a phone number.
 *
 * Numbers reach the system however they were typed — "+92 300 1234567",
 * "0300-1234567", "(0300) 1234567" — and all of those are one person calling
 * to order. Keeping the last ten digits ignores the parts that vary: spacing,
 * punctuation, the country code and the trunk zero that replaces it.
 *
 * Ten digits, not the whole number, because "+923001234567" and "03001234567"
 * differ in exactly the prefix. It is a grouping key, never a phone number to
 * display or dial: the original is always kept and shown.
 */
export function phoneKey(input) {
  const digits = String(input ?? "").replace(/\D/g, "");
  return digits.length ? digits.slice(-10) : "";
}
