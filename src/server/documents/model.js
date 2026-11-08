import { formatMoney } from "@/lib/format";
import { safeText } from "@/server/documents/text";

/**
 * The shape a printable document has, independent of how it is drawn.
 *
 * Two things want PDFs — a tax invoice and a payslip — and they are not the
 * same document at all: one has two parties and a tax breakdown, the other has
 * attendance figures and earnings against deductions. What they *do* share is
 * their furniture: a heading, a reference number, columns of figures that must
 * line up on the decimal, a totals block, and a footer saying where it came
 * from.
 *
 * So the furniture is modelled here and drawn once in `render.js`, and each
 * document is a pure function from its payload to this model. That split is
 * deliberate:
 *
 *   * **Everything that could be wrong is testable without a PDF.** Whether a
 *     void invoice carries its banner, whether a zero delivery fee is hidden,
 *     whether deductions print as negatives — all assertions on a plain
 *     object. Proving any of that by reading bytes out of a rendered PDF would
 *     be so awkward that in practice nobody would.
 *   * **The renderer has no opinions.** It knows about pages, columns and
 *     fonts. It does not know what an invoice is, so it cannot get one wrong.
 *
 * The model:
 *
 *   {
 *     title, reference, banner,          // "INVOICE", "INV-000123", "VOID — …"
 *     issuer: { name, lines[] },         // who produced it
 *     parties: [{ title, lines[] }],     // billed to / against, employee / period
 *     table:  { columns[], rows[] },     // the figures
 *     totals: [{ label, value, strong }],
 *     notes:  [string],
 *     footer: string,
 *   }
 *
 * Every string in it has already been through `safeText`, so the renderer never
 * has to think about encoding.
 */

/** A money string for the document, encoding-safe. */
export function documentMoney(amount, currency = "PKR") {
  return safeText(formatMoney(amount ?? 0, currency));
}

/**
 * A date as a document should carry it: unambiguous, and in the timezone of the
 * place that issued it.
 *
 * `2 Nov` is fine on a screen you are looking at today and useless on a
 * document somebody files for six years, so the year is always present. The
 * month is a name because 03/04 is two different days depending on who reads
 * it.
 */
export function documentDate(value, { timeZone, withTime = false } = {}) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return safeText(
    date.toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
      ...(timeZone ? { timeZone } : {}),
    }),
  );
}

/** Address lines from a branch or an address snapshot, in postal order. */
export function postalLines(source) {
  if (!source || typeof source !== "object") return [];

  return [
    source.line1 ?? source.addressLine1,
    source.line2 ?? source.addressLine2,
    [source.city, source.state].filter(Boolean).join(", ") || null,
    [source.postalCode, source.country].filter(Boolean).join(" ") || null,
  ]
    .filter((line) => typeof line === "string" && line.trim())
    .map((line) => safeText(line.trim()));
}

/** Drops blank lines and makes what is left safe to draw. */
export function textLines(lines) {
  return lines.filter((line) => line !== null && line !== undefined && String(line).trim() !== "").map((line) => safeText(line));
}
