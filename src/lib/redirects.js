import { DASHBOARD_NAV, navItemCount } from "@/lib/dashboard-nav";

/**
 * Where to send someone after they sign in.
 *
 * The destination arrives in the URL (`/login?next=/orders`), which means it is
 * attacker-controlled: a link that logs you in and lands you on a lookalike
 * site is a classic open-redirect phish, and it is convincing precisely because
 * the login it passed through was genuine.
 *
 * So only a path on this site is ever honoured. Anything else falls back.
 * Rejected, specifically:
 *
 *   - absolute URLs (`https://evil.example`) — off-site
 *   - protocol-relative (`//evil.example`) — off-site, and easy to miss
 *   - backslash variants (`/\evil.example`) — some browsers normalise these
 *     to `//`, so they are off-site too
 *   - anything not starting with `/` — relative paths resolve against whatever
 *     page we happen to be on
 *   - the auth pages themselves — bouncing someone back to the login form they
 *     just completed reads as a failed login
 */
const AUTH_PATHS = ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email"];

export function safeRedirect(value, fallback = "/") {
  if (typeof value !== "string" || value.length === 0) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;

  // Compare the path alone, so `/login?next=/login%3Ffoo` is caught too.
  const path = value.split(/[?#]/)[0];
  if (AUTH_PATHS.includes(path)) return fallback;

  return value;
}

/**
 * `/login?next=…` for a visitor who is partway through something.
 *
 * `safeRedirect` does the filtering, which also means an auth page passed in
 * here collapses to a plain `/login` — signing in from the register page should
 * not bounce you back to the register page.
 */
export function loginHref(next) {
  const target = safeRedirect(next);
  return target === "/" ? "/login" : `/login?next=${encodeURIComponent(target)}`;
}

/** The same, for `/register`. */
export function registerHref(next) {
  const target = safeRedirect(next);
  return target === "/" ? "/register" : `/register?next=${encodeURIComponent(target)}`;
}

/**
 * Where somebody lands the moment they sign in.
 *
 * Email verification is a customer gate: it exists because an unverified
 * account cannot check out, so sending them to finish verifying beats letting
 * them fill a basket and be stopped at the last step. A member of staff has no
 * basket. Routing on `emailVerified` alone sent every cashier, chef and rider
 * to a consumer page headed "unlock secret menu items", asking for a code
 * posted to an address the restaurant invented for them — and the dashboard
 * they were hired to use was reachable only by typing the URL.
 *
 * So the question asked here is the one the workspace layout already asks: is
 * there a single staff page this person may open?
 */
export function signInDestination(user, next, { staffHome = "/dashboard" } = {}) {
  const staff = navItemCount(DASHBOARD_NAV, user?.permissions ?? []) > 0;
  if (staff) {
    const target = safeRedirect(next, staffHome);
    return target === "/" ? staffHome : target;
  }
  return user?.emailVerified ? safeRedirect(next) : "/verify-email";
}
