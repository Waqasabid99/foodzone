/**
 * Delivery or pickup — the website's order type, remembered the way the
 * selected branch is.
 *
 * It lives in a cookie as well as on the cart because the menu and product
 * pages are rendered on the server, and the order type decides which menu —
 * and so which prices — they show. The cart can only be read in the browser
 * (a guest's basket is keyed by local storage), so without the cookie the page
 * would quote one menu's prices while checkout charged another's.
 *
 * The cart stays the authority: every cart read writes its type back here.
 */

export const ORDER_TYPE_COOKIE = "fz_order_type";

/** The order types a website customer can choose. Dine-in is the QR flow's. */
export const WEB_ORDER_TYPES = ["DELIVERY", "PICKUP"];

/** Matches the cart's own default, so a visitor with no cart sees what they would be charged. */
export const DEFAULT_ORDER_TYPE = "DELIVERY";

const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function resolveOrderType(value) {
  return WEB_ORDER_TYPES.includes(value) ? value : DEFAULT_ORDER_TYPE;
}

export function readOrderTypeCookie() {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${ORDER_TYPE_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function writeOrderTypeCookie(type) {
  if (typeof document === "undefined" || !WEB_ORDER_TYPES.includes(type)) return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${ORDER_TYPE_COOKIE}=${type}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}
