import { Prisma } from "@/generated/prisma";

/**
 * Makes Prisma results safe to hand to `JSON.stringify`.
 *
 * Three types in a Prisma row do not survive JSON unassisted:
 *   * `Decimal` — every price, quantity and ledger amount in this schema
 *   * `Date`    — serialises fine, but we want a stable ISO string everywhere
 *   * `BigInt`  — throws outright
 *
 * Decimals become numbers rather than strings, matching the existing API
 * contract (`totalAmount: 12.5`, not `"12.50"`). Every monetary column is
 * Decimal(18,4) and every quantity Decimal(18,6), so values stay far inside
 * the range a double represents exactly — but do arithmetic in Decimal on the
 * server and only serialise at the edge, never the other way round.
 */
export function serialize(value) {
  if (value === null || value === undefined) return value;

  if (Prisma.Decimal.isDecimal(value)) return value.toNumber();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return Number(value);

  if (Array.isArray(value)) return value.map(serialize);

  // Plain objects only: leave class instances (Buffer, streams) untouched.
  if (typeof value === "object" && (value.constructor === Object || value.constructor === undefined)) {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = serialize(item);
    return out;
  }

  // Prisma model rows are plain objects, but be defensive about anything else
  // carrying a toJSON of its own.
  if (typeof value === "object" && typeof value.toJSON === "function") return value.toJSON();

  return value;
}

/** Strips keys that must never leave the server (password hashes, raw tokens). */
export function omit(record, keys) {
  if (!record) return record;
  const out = { ...record };
  for (const key of keys) delete out[key];
  return out;
}

/** Keeps only the listed keys — safer than `omit` for user-facing shapes. */
export function pick(record, keys) {
  if (!record) return record;
  const out = {};
  for (const key of keys) if (key in record) out[key] = record[key];
  return out;
}
