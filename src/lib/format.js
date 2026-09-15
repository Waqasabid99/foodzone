/**
 * Display formatting.
 *
 * Money is formatted on the server so a price reads the same for every visitor
 * regardless of their browser locale — a restaurant quotes one price, and a
 * number that renders as "1.234,50" for some customers and "1,234.50" for
 * others is a support ticket waiting to happen.
 */

const FALLBACK_CURRENCY = "PKR";

/**
 * Formats an amount in the store's currency.
 *
 * Accepts a string, number, or `Prisma.Decimal` — service layers hand back
 * decimals as strings to avoid float drift, so the string path is the normal
 * one and must not be lossy.
 */
export function formatMoney(amount, currency = FALLBACK_CURRENCY, { locale = "en-US" } = {}) {
  if (amount === null || amount === undefined) return "";

  const value = typeof amount === "number" ? amount : Number(String(amount));
  if (!Number.isFinite(value)) return "";

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      // Restaurant prices are quoted whole far more often than not, so trailing
      // ".00" is noise; a price with real minor units still shows them.
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // An unrecognised currency code must not take the page down with it.
    return `${currency} ${value.toFixed(Number.isInteger(value) ? 0 : 2)}`;
  }
}

/** "4.8" from 4.75, for a rating badge. */
export function formatRating(rating) {
  const value = Number(rating);
  return Number.isFinite(value) ? value.toFixed(1) : null;
}

/** Initials for an avatar chip: "Jake D." -> "JD". */
export function initials(name) {
  return String(name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
