import { DOCUMENT_FONT, DOCUMENT_FONT_BOLD } from "@/server/documents/text";

/**
 * Draws a document model onto A4.
 *
 * Knows about pages, columns and fonts; knows nothing about invoices or
 * payslips. Everything it draws came out of a pure model that was already
 * tested, so a bug here is a bug in *layout* — something overlapping, or
 * running off a page — and never a wrong number.
 *
 * Two things it gets right that a naive implementation does not:
 *
 *   * **Rows do not straddle a page break.** A table that runs past the bottom
 *     margin starts a new page and redraws the column headings, so page two is
 *     readable on its own. A row is measured *before* it is drawn, because
 *     measuring afterwards is how half a line ends up on each page.
 *   * **Figures line up on the right edge, not on a tab stop.** Money is
 *     right-aligned inside a fixed column width, so a four-figure total and a
 *     six-figure one still read as a column.
 *
 * pdfkit is imported lazily. Without that, every route that happens to touch
 * the invoice service drags a megabyte of font machinery into its bundle.
 */

const PAGE = { size: "A4", margin: 48 };
const RULE = "#000000";
const MUTED = "#444444";

/**
 * Starts collecting a pdfkit document into one buffer.
 *
 * Listeners are attached before anything is drawn and `end()` is deliberately
 * *not* called here — the caller ends the document once the last page is laid
 * out. Ending it up front is how this first went wrong: pdfkit closed the
 * stream, and the first page to flush threw `ERR_STREAM_PUSH_AFTER_EOF`.
 */
function collect(doc) {
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));

  return new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

export async function renderDocument(model, { createdAt = new Date() } = {}) {
  const { default: PDFDocument } = await import("pdfkit");

  const doc = new PDFDocument({
    ...PAGE,
    // Required for `bufferedPageRange`/`switchToPage`: the footer says "2 of
    // 3", and that total is only knowable once every page exists, so pages are
    // held rather than streamed out as they are finished.
    bufferPages: true,
    info: {
      Title: `${model.title} ${model.reference}`.trim(),
      Author: model.issuer?.name ?? "",
      // Fixed from the caller's clock rather than read from the process, so a
      // test can produce the same bytes twice.
      CreationDate: createdAt,
    },
  });
  const buffer = collect(doc);

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;
  const bottom = doc.page.height - doc.page.margins.bottom;

  // --- banner ---------------------------------------------------------------
  // First, boxed and in capitals: a voided invoice or a draft payslip must
  // declare itself before anybody reads a figure on it.
  if (model.banner) {
    doc.font(DOCUMENT_FONT_BOLD).fontSize(11);
    const height = doc.heightOfString(model.banner, { width: width - 16, align: "center" }) + 12;
    doc.lineWidth(1.5).rect(left, doc.y, width, height).stroke(RULE);
    doc.text(model.banner, left + 8, doc.y + 6, { width: width - 16, align: "center" });
    doc.y += 10;
  }

  // --- heading --------------------------------------------------------------
  const headTop = doc.y;
  doc.font(DOCUMENT_FONT_BOLD).fontSize(15).text(model.issuer?.name ?? "", left, headTop, { width: width * 0.58 });
  doc.font(DOCUMENT_FONT).fontSize(9).fillColor(MUTED);
  for (const line of model.issuer?.lines ?? []) doc.text(line, { width: width * 0.58 });
  const issuerBottom = doc.y;

  doc.fillColor(RULE).font(DOCUMENT_FONT_BOLD).fontSize(20);
  doc.text(model.title, left + width * 0.6, headTop, { width: width * 0.4, align: "right" });
  doc.font(DOCUMENT_FONT).fontSize(10);
  if (model.reference) doc.text(model.reference, { width: width * 0.4, align: "right" });
  if (model.issuedLabel) {
    doc.fontSize(9).fillColor(MUTED).text(model.issuedLabel, { width: width * 0.4, align: "right" });
  }

  doc.fillColor(RULE);
  doc.y = Math.max(issuerBottom, doc.y) + 12;
  doc.lineWidth(1).moveTo(left, doc.y).lineTo(right, doc.y).stroke(RULE);
  doc.y += 14;

  // --- parties --------------------------------------------------------------
  const partyTop = doc.y;
  const partyWidth = (width - 20) / Math.max(1, (model.parties ?? []).length);
  let partyBottom = partyTop;

  for (const [index, party] of (model.parties ?? []).entries()) {
    const x = left + index * (partyWidth + 20);
    doc.font(DOCUMENT_FONT_BOLD).fontSize(8).fillColor(MUTED).text(party.title.toUpperCase(), x, partyTop, { width: partyWidth });
    doc.font(DOCUMENT_FONT).fontSize(10).fillColor(RULE);
    for (const line of party.lines ?? []) doc.text(line, x, doc.y, { width: partyWidth });
    partyBottom = Math.max(partyBottom, doc.y);
  }
  doc.y = partyBottom + 18;

  // --- table ----------------------------------------------------------------
  const columns = scaleColumns(model.table?.columns ?? [], width);

  /**
   * The column headings, every one on the same baseline.
   *
   * `doc.text` advances the cursor, so each heading has to be drawn at a `top`
   * captured once rather than at the live `doc.y`. Nudging the cursor back
   * between columns instead — which is what this did first — left each heading
   * a few points lower than the one before it, and the row read as a staircase.
   */
  const drawHead = () => {
    doc.font(DOCUMENT_FONT_BOLD).fontSize(9).fillColor(RULE);
    const top = doc.y;
    let x = left;

    for (const column of columns) {
      doc.text(column.label, x, top, { width: column.width - 8, align: column.align ?? "left", lineBreak: false });
      x += column.width;
    }

    doc.y = top + doc.currentLineHeight() + 4;
    doc.lineWidth(0.8).moveTo(left, doc.y).lineTo(right, doc.y).stroke(RULE);
    doc.y += 6;
  };

  drawHead();
  doc.font(DOCUMENT_FONT).fontSize(10);

  for (const row of model.table?.rows ?? []) {
    const bold = Boolean(row.heading);
    doc.font(bold ? DOCUMENT_FONT_BOLD : DOCUMENT_FONT);

    // Measured before anything is drawn: the tallest cell decides the row, and
    // a row that will not fit moves whole rather than splitting across pages.
    const height = Math.max(
      ...columns.map((column) =>
        doc.heightOfString(String(row[column.key] ?? ""), { width: column.width - 8, align: column.align ?? "left" }),
      ),
      12,
    );

    if (doc.y + height + 18 > bottom) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      drawHead();
      doc.font(bold ? DOCUMENT_FONT_BOLD : DOCUMENT_FONT).fontSize(10);
    }

    const top = doc.y;
    let x = left;
    for (const column of columns) {
      doc.text(String(row[column.key] ?? ""), x, top, {
        width: column.width - 8,
        align: column.align ?? "left",
      });
      x += column.width;
    }

    doc.y = top + height + 5;
    doc.lineWidth(0.3).moveTo(left, doc.y - 2).lineTo(right, doc.y - 2).strokeColor("#bbbbbb").stroke();
    doc.strokeColor(RULE);
  }

  // --- totals ---------------------------------------------------------------
  // Right-hand block, because that is where every reader of a bill looks for
  // the number they owe.
  const totalsWidth = 250;
  const totalsLeft = right - totalsWidth;
  doc.y += 8;

  if (doc.y + (model.totals?.length ?? 0) * 16 + 40 > bottom) {
    doc.addPage();
    doc.y = doc.page.margins.top;
  }

  for (const total of model.totals ?? []) {
    doc.font(total.strong ? DOCUMENT_FONT_BOLD : DOCUMENT_FONT).fontSize(total.strong ? 11 : 10);

    if (total.strong) {
      doc.lineWidth(0.8).moveTo(totalsLeft, doc.y).lineTo(right, doc.y).stroke(RULE);
      doc.y += 4;
    }

    const top = doc.y;
    doc.text(total.label, totalsLeft, top, { width: totalsWidth - 110 });
    doc.text(total.value, totalsLeft + totalsWidth - 105, top, { width: 105, align: "right" });
    doc.y = Math.max(doc.y, top + doc.currentLineHeight()) + 3;
  }

  // --- notes and footer -----------------------------------------------------
  if (model.notes?.length) {
    doc.y += 14;
    doc.font(DOCUMENT_FONT).fontSize(9).fillColor(MUTED);
    for (const note of model.notes) doc.text(note, left, doc.y, { width: width * 0.7 });
    doc.fillColor(RULE);
  }

  // Footers last, then close: `stampFooters` revisits every page, which is
  // only possible while they are still buffered.
  stampFooters(doc, model.footer ?? "");
  doc.end();

  return buffer;
}

/**
 * Fits the declared column widths to the page.
 *
 * The models declare widths in points at A4 — convenient to write and to read
 * — but a column set that adds up to slightly more than the text width would
 * silently push the last column off the right edge. Scaling makes the
 * declaration a *ratio*, so the table always ends exactly at the margin.
 */
function scaleColumns(columns, width) {
  const declared = columns.reduce((sum, column) => sum + (column.width ?? 0), 0);
  if (!declared) return columns;

  const factor = width / declared;
  return columns.map((column) => ({ ...column, width: (column.width ?? 0) * factor }));
}

/**
 * Walks every page once at the end to write "1 of 3".
 *
 * It has to be the end: the total is not known until the last page exists, and
 * a footer written as each page is laid out would have to guess.
 */
function stampFooters(doc, footer) {
  const range = doc.bufferedPageRange();

  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);

    /*
     * The footer sits in the bottom margin, which is exactly where pdfkit
     * refuses to write: text past the margin makes it start a new page. Left
     * alone, stamping footers onto a two-page invoice produced six pages —
     * each stamp adding a page, which then needed a stamp of its own.
     *
     * Dropping the bottom margin for the duration is the documented way round
     * it. `range.count` was read before the loop, so even a stray page could
     * not extend it.
     */
    const margin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    const y = doc.page.height - margin + 16;
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    doc.font(DOCUMENT_FONT).fontSize(8).fillColor(MUTED);
    if (footer) doc.text(footer, left, y, { width: width * 0.7, lineBreak: false });
    doc.text(`${index + 1} of ${range.count}`, left + width * 0.7, y, { width: width * 0.3, align: "right", lineBreak: false });

    doc.page.margins.bottom = margin;
  }
}
