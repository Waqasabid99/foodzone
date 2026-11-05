import { NextResponse } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/api/cookie-names";

/**
 * CORS for the v1 API.
 *
 * React Native's native runtime ignores CORS entirely, but Expo web builds and
 * any separately-hosted client do not, so the API answers preflights explicitly.
 *
 * Allowed origins come from CORS_ALLOWED_ORIGINS (comma-separated). Credentials
 * are allowed so browser clients can keep using cookies, which means the
 * wildcard origin is not an option — each origin is echoed back individually.
 */
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function corsHeaders(origin) {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });

  if (origin && allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  return headers;
}

/**
 * Workspace pages, where a lapsed access token is not a logout.
 *
 * Access tokens last fifteen minutes; the session behind them lasts thirty
 * days. The browser client already knows this and refreshes on a 401, but a
 * server-rendered page is not an XHR: it reads the cookie, finds nothing, and
 * redirects to the login screen. Somebody who served a table for a quarter of
 * an hour and then tapped "Orders" was shown a login form with a perfectly
 * good session in the cookie jar.
 *
 * Nothing is verified here — the refresh cookie is only checked for presence,
 * and `/session/resume` does the real exchange against the API. A forged or
 * revoked cookie buys a redirect to a page that will bounce it to the login
 * screen, which is where it was going anyway. Every page and endpoint still
 * states its own requirements.
 */
const SESSION_AWARE = ["/dashboard", "/account"];

function needsSession(pathname) {
  return SESSION_AWARE.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function proxy(request) {
  const origin = request.headers.get("origin");
  const { pathname, search } = request.nextUrl;

  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (needsSession(pathname)) {
    const hasAccess = Boolean(request.cookies.get(ACCESS_COOKIE)?.value);
    const hasRefresh = Boolean(request.cookies.get(REFRESH_COOKIE)?.value);

    if (!hasAccess && hasRefresh && request.method === "GET") {
      const resume = new URL("/session/resume", request.url);
      resume.searchParams.set("next", `${pathname}${search}`);
      return NextResponse.redirect(resume);
    }

    // So the page that redirects an actual guest to the login screen can name
    // the page they asked for. Absent, the layout falls back to /dashboard —
    // which is exactly what it did before, so a matcher change degrades to the
    // old behaviour rather than to a broken one.
    const headers = new Headers(request.headers);
    headers.set("x-fz-path", `${pathname}${search}`);
    return NextResponse.next({ request: { headers } });
  }

  const response = NextResponse.next();
  corsHeaders(origin).forEach((value, key) => response.headers.set(key, value));
  return response;
}

export const config = {
  matcher: ["/api/:path*", "/dashboard/:path*", "/account/:path*"],
};
