/**
 * The smallest useful formatting for owner-edited prose.
 *
 * Blank lines separate paragraphs; a line beginning `## ` is a heading. That
 * is the whole language.
 *
 * Deliberately not Markdown and deliberately not HTML. The people editing
 * these pages are correcting a phone number or a refund window, not authoring
 * documents, and every richer option buys that audience nothing while costing
 * something real: HTML in a textarea is a cross-site scripting hole wearing a
 * convenient disguise, and a Markdown renderer is a dependency plus a surface
 * area of ways to produce a page that looks broken. Here the worst thing an
 * editor can type is a paragraph that was meant to be a heading.
 *
 * Returns blocks rather than markup so the caller decides how they look, and
 * so this stays testable without a DOM.
 */
export function parseProse(text) {
  const blocks = [];
  let paragraph = [];

  /*
   * Line by line, not block by block.
   *
   * Splitting on blank lines first looks simpler and is wrong: somebody who
   * types a heading and then starts the sentence on the very next line — which
   * is what everybody does — produces one block, and the whole paragraph ends
   * up inside the `<h2>`. A heading is its own thing wherever it appears, so a
   * `## ` line both ends the paragraph above it and never absorbs the one
   * below.
   */
  const flush = () => {
    if (!paragraph.length) return;
    // Single newlines inside a paragraph are a wrapped line, not a new
    // paragraph — somebody's editor wrapped it, or they hit return once.
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };

  for (const raw of String(text ?? "").replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();

    if (!line) {
      flush();
    } else if (line.startsWith("## ")) {
      flush();
      blocks.push({ type: "heading", text: line.slice(3).trim() });
    } else {
      paragraph.push(line);
    }
  }

  flush();
  return blocks;
}

/** The first paragraph, for a meta description when no summary was written. */
export function firstParagraph(text, limit = 160) {
  const paragraph = parseProse(text).find((block) => block.type === "paragraph");
  if (!paragraph) return "";
  return paragraph.text.length > limit ? `${paragraph.text.slice(0, limit - 1).trimEnd()}…` : paragraph.text;
}
