import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";

/**
 * Human-facing document numbers: orders, invoices, GRNs, journal entries.
 *
 * These cannot be cuids — an accountant reads them aloud and a tax authority
 * expects a sequence. They also cannot be `COUNT(*) + 1`, which duplicates
 * under concurrency.
 *
 * The counter row is locked with `SELECT ... FOR UPDATE` for the duration of
 * the caller's transaction, so two simultaneous checkouts serialise on that one
 * row and receive consecutive numbers. Always pass the transaction client that
 * is creating the document, so the number and the row commit or roll back
 * together — otherwise a failed order burns a number and leaves a visible gap.
 *
 * `IS NOT DISTINCT FROM` is deliberate: `branchId` and `periodKey` are nullable
 * and `= NULL` never matches in SQL.
 */
export async function nextDocumentNumber(
  client,
  { documentType, branchId = null, periodKey = null, prefix = "", padding = 4 },
) {
  const db = client ?? prisma;

  const rows = await db.$queryRaw(Prisma.sql`
    SELECT id, "nextValue", "prefix", "padding"
    FROM "NumberSequence"
    WHERE "documentType" = ${documentType}
      AND "branchId" IS NOT DISTINCT FROM ${branchId}
      AND "periodKey" IS NOT DISTINCT FROM ${periodKey}
    FOR UPDATE
  `);

  let value;
  let resolvedPrefix = prefix;
  let resolvedPadding = padding;

  if (rows.length === 0) {
    // First document of this type/branch/period.
    const created = await db.numberSequence.create({
      data: { documentType, branchId, periodKey, prefix, padding, nextValue: 2 },
      select: { prefix: true, padding: true },
    });
    value = 1;
    resolvedPrefix = created.prefix;
    resolvedPadding = created.padding;
  } else {
    const row = rows[0];
    value = row.nextValue;
    resolvedPrefix = row.prefix || prefix;
    resolvedPadding = row.padding ?? padding;

    await db.numberSequence.update({
      where: { id: row.id },
      data: { nextValue: value + 1 },
    });
  }

  return formatDocumentNumber({ prefix: resolvedPrefix, periodKey, value, padding: resolvedPadding });
}

export function formatDocumentNumber({ prefix = "", periodKey = null, value, padding = 4 }) {
  const parts = [prefix, periodKey, String(value).padStart(padding, "0")].filter(Boolean);
  return parts.join("-");
}

/** "2026-09" — the usual period bucket, so counters reset each month. */
export function monthPeriodKey(date = new Date(), timeZone = "UTC") {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year").value;
  const month = parts.find((part) => part.type === "month").value;
  return `${year}-${month}`;
}

/** "2026-09-08" — for counters that reset daily, such as order numbers. */
export function dayPeriodKey(date = new Date(), timeZone = "UTC") {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
