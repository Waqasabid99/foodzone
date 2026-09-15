import { NextResponse } from "next/server";
import { ErrorCode, STATUS_BY_CODE, ApiError } from "@/lib/api/errors";
import { serialize } from "@/lib/api/serialize";

// Re-exported so existing route handlers keep importing errors from here.
export { ErrorCode, ApiError };

/**
 * Every response, success or failure, is one of two JSON shapes so a client can
 * parse without ever branching on content type:
 *
 *   { success: true,  data, meta? }
 *   { success: false, error: { code, message, details? } }
 */
export function ok(data, { status = 200, meta, headers } = {}) {
  return NextResponse.json(
    { success: true, data: serialize(data), ...(meta ? { meta: serialize(meta) } : {}) },
    { status, headers },
  );
}

/** 201 with an optional `Location` header. */
export function created(data, { location, meta } = {}) {
  return ok(data, { status: 201, meta, headers: location ? { Location: location } : undefined });
}

/** 204 for deletes and other empty successes. */
export function noContent(headers) {
  return new NextResponse(null, { status: 204, headers });
}

/** A cursor-paginated list. `meta.nextCursor` is null on the last page. */
export function paginated(items, { nextCursor = null, limit, total } = {}) {
  return ok(items, {
    meta: {
      nextCursor,
      hasMore: Boolean(nextCursor),
      ...(limit !== undefined ? { limit } : {}),
      ...(total !== undefined ? { total } : {}),
    },
  });
}

export function fail(code, message, { details, status, headers } = {}) {
  return NextResponse.json(
    { success: false, error: { code, message, ...(details ? { details: serialize(details) } : {}) } },
    { status: status ?? STATUS_BY_CODE[code] ?? 500, headers },
  );
}

/** Turns an ApiError into its response. */
export function failFrom(error) {
  return fail(error.code, error.message, { details: error.details, headers: error.headers });
}
