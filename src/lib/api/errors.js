/**
 * The error vocabulary of the API.
 *
 * These codes are a public contract: the website and the mobile app branch on
 * `error.code`, never on `error.message`, so messages can be reworded freely
 * but a code may only be added, never repurposed.
 */
export const ErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
  CONFLICT: "CONFLICT",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
};

export const STATUS_BY_CODE = {
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.METHOD_NOT_ALLOWED]: 405,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.PAYLOAD_TOO_LARGE]: 413,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
};

/**
 * Thrown by services and middleware. Route handlers never build an error
 * response by hand — `apiHandler` turns these into the standard envelope.
 */
/**
 * Whether an error really means "there is no such record".
 *
 * A page that reads `catch(() => notFound())` tells a cashier the order does
 * not exist when the database merely timed out. The two are not the same
 * answer and only one of them is true, so a page that wants to show its
 * not-found screen says so about not-found errors and lets everything else
 * reach the error boundary, which says the screen failed to load.
 */
export function isNotFound(error) {
  return error instanceof ApiError && error.status === 404;
}

/** Whether an error means "this is not yours to open". */
export function isForbidden(error) {
  return error instanceof ApiError && error.status === 403;
}

/**
 * The record, or null when it genuinely is not there.
 *
 * The shape to reach for instead of `.catch(() => null)` in front of a
 * `notFound()`. Swallowing every error there answers one question with
 * another's answer: a dropped connection becomes "this record does not exist
 * or is not one you can open", which is a sentence that tells a manager their
 * delivery note is gone when the database merely blinked. It also means the
 * failure is never logged and never reaches the error boundary, so nobody
 * finds out there was anything to fix.
 */
export async function nullIfMissing(promise) {
  try {
    return await promise;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/**
 * The record, or null when it is not there *or* not theirs.
 *
 * For the access assertions, which answer both ways on purpose: another
 * branch's record is a 404 rather than a 403, because learning that it exists
 * elsewhere is itself more than a scoped supervisor should know. Both answers
 * mean the same thing to the page — show the not-found screen — while
 * anything else is still a real failure.
 */
export async function nullIfUnreachable(promise) {
  try {
    return await promise;
  } catch (error) {
    if (isNotFound(error) || isForbidden(error)) return null;
    throw error;
  }
}

export class ApiError extends Error {
  constructor(code, message, { details, headers, cause } = {}) {
    super(message, { cause });
    this.name = "ApiError";
    this.code = code;
    this.status = STATUS_BY_CODE[code] ?? 500;
    this.details = details;
    /// Extra response headers, e.g. `Retry-After` on a rate-limit rejection.
    this.headers = headers;
    /// Marks this as a deliberate, user-facing error rather than a crash, so
    /// the handler logs it at a lower level.
    this.expected = true;
  }

  static validation(message = "The request could not be validated", details) {
    return new ApiError(ErrorCode.VALIDATION_ERROR, message, { details });
  }
  static unauthorized(message = "Authentication required") {
    return new ApiError(ErrorCode.UNAUTHORIZED, message);
  }
  static forbidden(message = "You do not have access to this resource", details) {
    return new ApiError(ErrorCode.FORBIDDEN, message, { details });
  }
  static notFound(message = "Resource not found") {
    return new ApiError(ErrorCode.NOT_FOUND, message);
  }
  static conflict(message = "That action conflicts with the current state", details) {
    return new ApiError(ErrorCode.CONFLICT, message, { details });
  }
  static tooLarge(message = "Request body is too large") {
    return new ApiError(ErrorCode.PAYLOAD_TOO_LARGE, message);
  }
  static rateLimited(message = "Too many requests", { retryAfterSeconds, details } = {}) {
    return new ApiError(ErrorCode.RATE_LIMITED, message, {
      details,
      headers: retryAfterSeconds ? { "Retry-After": String(retryAfterSeconds) } : undefined,
    });
  }
  static internal(message = "Something went wrong", { cause } = {}) {
    return new ApiError(ErrorCode.INTERNAL_ERROR, message, { cause });
  }
  static unavailable(message = "Service temporarily unavailable") {
    return new ApiError(ErrorCode.SERVICE_UNAVAILABLE, message);
  }
}

/**
 * Maps a Prisma error to the API contract.
 *
 * Without this, a duplicate email surfaces as a 500 and a raw Prisma message
 * leaks table and column names to the client.
 */
/**
 * Driver-level failures, which carry a POSIX code rather than a Prisma `P`
 * one.
 *
 * A serverless pooler drops connections routinely, and the drop can land
 * *after* the statement committed — so the request fails while the row exists.
 * These were falling through to "Something went wrong", which is both unhelpful
 * and, for a write, untrue: something may well have gone right.
 */
const CONNECTION_CODES = new Set(["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE", "ENOTFOUND", "EAI_AGAIN"]);

/**
 * `method` lets a write say what a read cannot: that the change may already
 * have been saved. Telling somebody to "try again" after a write that actually
 * landed is how duplicates get created.
 */
export function fromPrismaError(error, { method = "GET" } = {}) {
  const code = error?.code;

  if (typeof code === "string" && CONNECTION_CODES.has(code)) {
    const write = method !== "GET" && method !== "HEAD";
    return ApiError.unavailable(
      write
        ? "The database connection dropped. Your change may still have been saved — reload and check before trying again."
        : "The database connection dropped. Please try again.",
    );
  }

  if (typeof code !== "string" || !code.startsWith("P")) return null;

  const target = error?.meta?.target;
  const fields = Array.isArray(target) ? target : target ? [String(target)] : [];

  switch (code) {
    case "P2002": // unique constraint
      return ApiError.conflict(
        fields.length ? `${humanize(fields[0])} is already taken` : "That record already exists",
        fields.length ? { fields } : undefined,
      );
    case "P2025": // record required but not found
      return ApiError.notFound();
    case "P2003": // foreign key constraint
      return ApiError.validation("A referenced record does not exist", fields.length ? { fields } : undefined);
    case "P2000": // value too long for column
      return ApiError.validation("A submitted value is too long", fields.length ? { fields } : undefined);
    case "P2014": // relation violation
      return ApiError.conflict("That change would break a required relation");
    case "P1001": // cannot reach database
    case "P1002": // database timeout
    case "P1017": // server has closed the connection
      return ApiError.unavailable("The database is unreachable, please retry");
    default:
      return null;
  }
}

function humanize(field) {
  const label = String(field).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}
