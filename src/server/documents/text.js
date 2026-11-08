/**
 * What a PDF built on the standard fonts can actually print.
 *
 * The documents here use Helvetica, one of the fourteen fonts every PDF reader
 * is required to have. That costs nothing — no font file in the repository, no
 * megabyte of glyphs in the bundle, no licence to check — and it buys a
 * document that opens identically everywhere.
 *
 * The price is the encoding. A standard font is **WinAnsi**: Latin-1 plus a few
 * extras. It has no rupee sign, no Urdu, no Chinese. Handed one, pdfkit writes
 * a byte that means something else, and the customer gets a document with
 * mojibake in the total — or, worse, a name that is not theirs.
 *
 * So text is cleaned on the way in rather than hoped about:
 *
 *   * **Currency symbols become their ISO codes.** `₹1,234` prints as
 *     `INR 1,234`, which is correct, unambiguous and printable. `Intl` already
 *     formats PKR and AED as a code, so for this system's own currency this
 *     changes nothing.
 *   * **A few typographic characters are folded** to their ASCII equivalents —
 *     curly quotes, en and em dashes, the ellipsis — because they turn up in
 *     product names and notes constantly and all of them have a sane fallback.
 *   * **Anything still unprintable is replaced and reported.** Not dropped: a
 *     name silently shortened is worse than a name with a visible gap in it,
 *     because nobody notices the first one. The caller gets a count so it can
 *     log that a document went out degraded.
 *
 * Embedding a Unicode font would lift the Latin limit, and `DOCUMENT_FONT` is
 * the single place that would change. It would not solve Urdu or Arabic, which
 * need shaping and right-to-left layout rather than just glyphs — that is a
 * different piece of work, and pretending otherwise with a font swap would
 * produce text that renders without being readable.
 */

/** The font family every document uses. One place, so a swap is one line. */
export const DOCUMENT_FONT = "Helvetica";
export const DOCUMENT_FONT_BOLD = "Helvetica-Bold";

/**
 * Currency symbols WinAnsi cannot encode, mapped to the code a reader can.
 *
 * Deliberately only the symbols that are *missing*: `$`, `£` and `¥` are all in
 * WinAnsi and print correctly, so they are left exactly as `Intl` wrote them.
 */
const CURRENCY_SYMBOLS = new Map([
  ["₨", "PKR"],
  ["₹", "INR"],
  ["₺", "TRY"],
  ["₦", "NGN"],
  ["₫", "VND"],
  ["₩", "KRW"],
  ["₪", "ILS"],
  ["₴", "UAH"],
  ["₸", "KZT"],
  ["₼", "AZN"],
  ["₾", "GEL"],
  ["€", "EUR"],
  ["﷼", "SAR"],
  ["د.إ", "AED"],
]);

/** Typography that appears in real product names and has an honest ASCII twin. */
const FOLDED = new Map([
  ["‘", "'"],
  ["’", "'"],
  ["“", '"'],
  ["”", '"'],
  ["–", "-"],
  ["—", "-"],
  ["−", "-"],
  ["…", "..."],
  [" ", " "],
  [" ", " "],
  [" ", " "],
  ["•", "*"],
  ["­", ""],
]);

/**
 * True when this code point survives the WinAnsi encoding.
 *
 * ASCII below 0x20 is control characters, which have no business in a document;
 * 0x7f is delete; and the 0x80–0x9f band is where WinAnsi keeps its own
 * punctuation rather than Latin-1's controls, so it is printable here.
 */
function isPrintable(codePoint) {
  if (codePoint === 0x0a) return true; // newline, handled by the layout
  if (codePoint < 0x20 || codePoint === 0x7f) return false;
  return codePoint <= 0xff;
}

/**
 * Makes a string safe to draw, and says what it had to change.
 *
 * Returns `{ text, substitutions }`. Use `safeText` when the count is not
 * interesting, which is most call sites.
 */
export function toWinAnsi(value) {
  if (value === null || value === undefined) return { text: "", substitutions: 0 };

  let text = String(value);
  for (const [symbol, code] of CURRENCY_SYMBOLS) {
    if (text.includes(symbol)) text = text.split(symbol).join(code);
  }
  for (const [from, to] of FOLDED) {
    if (text.includes(from)) text = text.split(from).join(to);
  }

  let substitutions = 0;
  let out = "";
  // Iterated by code point, not by char, so an emoji's surrogate pair counts
  // as one substitution rather than two broken halves.
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (isPrintable(codePoint)) {
      out += character;
      continue;
    }
    substitutions += 1;
    out += "?";
  }

  // Runs of unprintable text collapse to a single marker: a name in a script
  // this font cannot write should read as "?" rather than "??????????".
  return { text: out.replace(/\?{2,}/g, "?"), substitutions };
}

export function safeText(value) {
  return toWinAnsi(value).text;
}
