/**
 * Browser-side client for the v1 API.
 *
 * The website relies on httpOnly cookies (`credentials: "include"`), so it never
 * touches tokens directly. The React Native app uses the same endpoints and the
 * same envelope, but stores the token pair itself and sends
 * `Authorization: Bearer` — see docs/API.md.
 */

export const API_BASE = "/api/v1";

const GUEST_SESSION_KEY = "fz_guest_session";

/**
 * A stable id for a browser that has no account yet.
 *
 * The cart is server-side for guests too — that is what lets someone fill a
 * basket, then sign in and keep it — and the server matches a guest cart by
 * this header. Without it a guest would get a brand new empty cart on every
 * request, which looks exactly like a cart that does not work.
 *
 * It identifies a basket, nothing more: it grants no access, and on login the
 * cart it names is claimed by the account and it stops mattering. Kept in
 * `localStorage` rather than a cookie so it is never attached to cross-site
 * requests, and regenerated silently if storage is unavailable.
 */
function guestSessionId() {
  if (typeof window === "undefined") return null;

  try {
    const existing = window.localStorage.getItem(GUEST_SESSION_KEY);
    // The server rejects anything outside this shape, so a value left over from
    // an older format is replaced rather than sent and silently ignored.
    if (existing && /^[A-Za-z0-9_-]{6,120}$/.test(existing)) return existing;

    const fresh = crypto.randomUUID();
    window.localStorage.setItem(GUEST_SESSION_KEY, fresh);
    return fresh;
  } catch {
    // Private mode, or storage disabled. A cart that lasts one page load is
    // still better than a request the server refuses.
    return null;
  }
}

export class ApiClientError extends Error {
  constructor({ code, message, details, status }) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

/**
 * Endpoints where a 401 is the answer, not a stale session.
 *
 * Retrying "incorrect email or password" through a token refresh would turn one
 * clear rejection into two round trips and a confusing second error, and
 * refreshing the refresh endpoint itself is an obvious loop.
 */
const NO_RETRY = ["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout"];

/**
 * The in-flight refresh, shared by every caller that hits a 401 at once.
 *
 * This has to be single-flight. Refresh tokens rotate, and the server treats a
 * second use of an already-rotated token as theft — it revokes the whole family
 * and signs the user out everywhere. Two components loading in parallel and
 * both refreshing would trigger exactly that, so they wait on one promise
 * instead.
 */
let refreshInFlight = null;

function refreshSession() {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: "web" }),
        credentials: "include",
      });
      return response.ok;
    } catch {
      // Offline, or the request was cut short. Either way there is no new
      // session, and the caller should surface its original 401.
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function send(path, { method, body, signal }) {
  const sessionId = guestSessionId();

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(sessionId ? { "x-session-id": sessionId } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
    signal,
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError({
      code: "INTERNAL_ERROR",
      message: "The server returned an unreadable response",
      status: response.status,
    });
  }

  return { response, payload };
}

async function request(path, { method = "GET", body, signal, retryOnUnauthorized = true } = {}) {
  let { response, payload } = await send(path, { method, body, signal });

  // Access tokens last 15 minutes; the session behind them lasts 30 days. So a
  // 401 usually means "this token aged out", not "you are signed out" — and
  // without this, anyone idle for a quarter of an hour would watch the site
  // decide they were a guest. One refresh, then one retry.
  if (
    response.status === 401 &&
    retryOnUnauthorized &&
    !NO_RETRY.includes(path) &&
    (await refreshSession())
  ) {
    ({ response, payload } = await send(path, { method, body, signal }));
  }

  if (!response.ok || payload?.success === false) {
    throw new ApiClientError({
      code: payload?.error?.code ?? "INTERNAL_ERROR",
      message: payload?.error?.message ?? "Something went wrong",
      details: payload?.error?.details,
      status: response.status,
    });
  }

  return payload.data;
}

export const api = {
  get: (path, options) => request(path, { ...options, method: "GET" }),
  post: (path, body, options) => request(path, { ...options, method: "POST", body }),
  put: (path, body, options) => request(path, { ...options, method: "PUT", body }),
  patch: (path, body, options) => request(path, { ...options, method: "PATCH", body }),
  delete: (path, options) => request(path, { ...options, method: "DELETE" }),
};
