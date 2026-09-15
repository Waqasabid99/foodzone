import { z } from "zod";

/**
 * Cursor pagination, not offset.
 *
 * `OFFSET 5000` makes Postgres walk 5000 rows it then throws away, and rows
 * shifting between pages cause duplicates and gaps. A cursor is stable and
 * costs the same on page 500 as on page 1.
 */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

export function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    // A malformed cursor is the client's problem, not a 500 — treat it as
    // "start from the beginning".
    return null;
  }
}

/**
 * Turns a `take: limit + 1` query result into a page. Fetching one extra row is
 * how you know whether a next page exists without a second COUNT query.
 */
export function toPage(rows, limit, toCursor = (row) => row.id) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  return {
    items,
    nextCursor: hasMore ? encodeCursor(toCursor(items[items.length - 1])) : null,
    limit,
  };
}

/** Prisma arguments for a keyset page. Pass the decoded cursor's id. */
export function cursorArgs(cursor, limit) {
  const decoded = decodeCursor(cursor);
  return {
    take: limit + 1,
    ...(decoded ? { cursor: { id: typeof decoded === "string" ? decoded : decoded.id }, skip: 1 } : {}),
  };
}
