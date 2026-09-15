import crypto from "node:crypto";

/**
 * Request-shaped helpers shared by the handler pipeline.
 *
 * `request.ip` and `request.geo` were removed in Next 15, so the client address
 * has to come from proxy headers. Order matters: the first entry of
 * `x-forwarded-for` is the original client, later entries are intermediaries.
 */
export function getClientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-vercel-forwarded-for") ??
    "unknown"
  );
}

export function getUserAgent(request) {
  return request.headers.get("user-agent") ?? null;
}

/**
 * Correlates log lines for one request. Honours an inbound `x-request-id` so a
 * trace started at the proxy or by the mobile app carries through.
 */
export function getRequestId(request) {
  return request.headers.get("x-request-id") ?? crypto.randomUUID();
}

const CLIENT_TYPES = new Set(["WEB", "IOS", "ANDROID", "POS", "KIOSK"]);

/**
 * Which client is calling, for per-device sessions and channel reporting.
 * Read from `x-client-platform`, falling back to a body field, then WEB.
 */
export function getClientType(request, bodyClient) {
  const header = request.headers.get("x-client-platform");
  const candidate = String(header ?? bodyClient ?? "").toUpperCase();
  return CLIENT_TYPES.has(candidate) ? candidate : "WEB";
}

/**
 * The anonymous session a guest's cart hangs off.
 *
 * Sent as `x-session-id` by both clients — a browser keeps it in local storage,
 * the app in secure storage. It is **not** a credential and grants nothing but
 * a basket: anyone holding it can read the cart it names, which is why a cart
 * carries no personal data and checkout re-verifies who the buyer is.
 */
export function getSessionId(request) {
  const value = request.headers.get("x-session-id")?.trim();
  if (!value) return null;
  // Bounded and charset-limited: it reaches a unique index and a log line.
  if (value.length < 6 || value.length > 120 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  return value;
}

/** Absolute origin of the current request, for building links in responses. */
export function getBaseUrl(request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const protocol = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${protocol}://${host}`;
}

/** Everything about the caller that services and the audit log care about. */
export function requestContext(request, bodyClient) {
  return {
    requestId: getRequestId(request),
    ipAddress: getClientIp(request),
    userAgent: getUserAgent(request),
    client: getClientType(request, bodyClient),
    sessionId: getSessionId(request),
  };
}
