import { NextResponse } from "next/server";

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

export function proxy(request) {
  const origin = request.headers.get("origin");

  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
  }

  const response = NextResponse.next();
  corsHeaders(origin).forEach((value, key) => response.headers.set(key, value));
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
