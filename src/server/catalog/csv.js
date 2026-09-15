/**
 * A minimal RFC 4180 CSV reader and writer.
 *
 * Written rather than taken from a package because the requirement is small and
 * exact: the file a spreadsheet produces must round-trip through the importer
 * unchanged. That means handling the four things spreadsheets actually emit —
 * quoted fields containing commas, quoted fields containing newlines, doubled
 * quotes as an escaped quote, and a UTF-8 BOM on the first cell — and nothing
 * more. A dependency would bring dialect options none of this needs.
 *
 * Both directions are pure string work, so the awkward cases are unit-tested
 * without a database.
 */

const BOM = "\ufeff";

/**
 * Parses CSV text into rows of strings.
 *
 * Line endings are normalised, so a file written on Windows and one written on
 * macOS parse identically. A trailing newline does not produce a final empty
 * row, because every spreadsheet writes one and none of them mean a blank
 * record by it.
 */
export function parseCsv(text) {
  if (typeof text !== "string") return [];

  const input = text.startsWith(BOM) ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let index = 0;
  // Distinguishes "" (an empty quoted field, a real value) from a field that
  // was never written to, which at the end of a line is nothing at all.
  let started = false;

  const endField = () => {
    row.push(field);
    field = "";
    started = false;
  };

  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (index < input.length) {
    const char = input[index];

    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"' && !started) {
      quoted = true;
      started = true;
      index += 1;
      continue;
    }

    if (char === ",") {
      endField();
      index += 1;
      continue;
    }

    if (char === "\r" || char === "\n") {
      endRow();
      // Treat CRLF as one break, not two.
      index += char === "\r" && input[index + 1] === "\n" ? 2 : 1;
      continue;
    }

    field += char;
    started = true;
    index += 1;
  }

  // Whatever is still buffered is the last row, unless the file simply ended
  // with a newline.
  if (started || field !== "" || row.length) endRow();

  return rows;
}

/**
 * Parses CSV into objects keyed by the header row.
 *
 * Headers are trimmed and lowercased so a spreadsheet that capitalised them, or
 * left a stray space after a comma, still imports. Short rows are padded rather
 * than rejected: a trailing empty column is routinely dropped by editors, and
 * failing the whole file for that would be infuriating.
 */
export function parseCsvRecords(text) {
  const rows = parseCsv(text).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (!rows.length) return { headers: [], records: [] };

  const headers = rows[0].map((header) => header.trim().toLowerCase());

  const records = rows.slice(1).map((row, index) => {
    const record = {};
    headers.forEach((header, column) => {
      record[header] = (row[column] ?? "").trim();
    });
    // Header row is line 1, so the first record is line 2 — the number the
    // person is looking at in their spreadsheet.
    return { line: index + 2, values: record };
  });

  return { headers, records };
}

/** Quotes a single field, only when it has to be quoted. */
export function escapeCsvField(value) {
  if (value === null || value === undefined) return "";

  const text = value instanceof Date ? value.toISOString() : String(value);
  // A leading or trailing space is meaningful in a name and is eaten by some
  // readers unless quoted.
  const mustQuote = /[",\r\n]/.test(text) || text !== text.trim();

  return mustQuote ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Writes rows of objects as CSV.
 *
 * CRLF line endings and a BOM, because the target is Excel: without the BOM it
 * reads a UTF-8 file as the local codepage and mangles every accented name.
 */
export function toCsv(columns, rows, { bom = true } = {}) {
  const lines = [columns.map(escapeCsvField).join(",")];

  for (const row of rows) {
    lines.push(columns.map((column) => escapeCsvField(row[column])).join(","));
  }

  return (bom ? BOM : "") + lines.join("\r\n") + "\r\n";
}
