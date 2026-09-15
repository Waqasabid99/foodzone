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
export function fromPrismaError(error) {
  const code = error?.code;
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
      return ApiError.unavailable("The database is unreachable, please retry");
    default:
      return null;
  }
}

function humanize(field) {
  const label = String(field).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}
