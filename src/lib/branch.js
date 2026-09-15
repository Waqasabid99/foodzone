/**
 * The visitor's chosen outlet.
 *
 * Kept in a cookie rather than `localStorage` because the server has to read
 * it: the menu is branch-scoped, so the choice has to be known before the page
 * is rendered, not after it hydrates.
 *
 * Deliberately not httpOnly and deliberately not trusted. A branch id is public
 * information — it is in the branch list this same page renders — so there is
 * nothing here to protect, and the value is validated against the real branch
 * list on every read anyway. Treating it as a hint rather than as state is what
 * makes a hand-edited cookie a non-event.
 */
export const BRANCH_COOKIE = "fz_branch";

/** A year: the outlet someone orders from is a standing preference. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Reads the cookie in the browser. Server components use `cookies()` instead. */
export function readBranchCookie() {
  if (typeof document === "undefined") return null;

  const match = document.cookie.match(new RegExp(`(?:^|; )${BRANCH_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function writeBranchCookie(branchId) {
  if (typeof document === "undefined") return;

  // `SameSite=Lax` so the choice survives arriving back from a payment gateway;
  // `Secure` only where the page is already on HTTPS, or local development
  // silently fails to set it at all.
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${BRANCH_COOKIE}=${encodeURIComponent(branchId)}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

/**
 * Picks the branch to serve from, given what the cookie claims.
 *
 * The cookie is checked against the live list, so a closed, renamed or deleted
 * outlet cannot go on being "selected" — and a single-outlet restaurant needs
 * no choice made at all, which is why the only branch is returned whether or
 * not anything was ever picked.
 */
export function resolveBranch(branches, cookieValue) {
  if (!Array.isArray(branches) || branches.length === 0) return null;
  if (branches.length === 1) return branches[0];

  return branches.find((branch) => branch.id === cookieValue || branch.code === cookieValue) ?? null;
}
