import { cookies } from "next/headers";
import { accessTokenTtlSeconds, refreshTokenTtlSeconds } from "@/lib/api/tokens";
import { isProduction } from "@/lib/env";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/api/cookie-names";

export { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/api/cookie-names";

/**
 * The website and the mobile app authenticate through the same endpoints; only
 * the transport differs. Browsers get httpOnly cookies (no token handling in
 * JS, so an XSS cannot read the session), while the app reads the same tokens
 * from the response body and stores them in the Keychain.
 *
 * `sameSite: lax` keeps the cookie on top-level navigations back from a payment
 * gateway while still blocking cross-site POSTs.
 */
function baseCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
  };
}

export function setSessionCookies(response, { accessToken, refreshToken }) {
  const base = baseCookieOptions();

  if (accessToken) {
    response.cookies.set(ACCESS_COOKIE, accessToken, { ...base, maxAge: accessTokenTtlSeconds() });
  }
  if (refreshToken) {
    response.cookies.set(REFRESH_COOKIE, refreshToken, { ...base, maxAge: refreshTokenTtlSeconds() });
  }

  return response;
}

export function clearSessionCookies(response) {
  // Overwrite with an expired value as well as deleting: some proxies drop a
  // bare delete, and a lingering session cookie is worse than a redundant one.
  const base = { ...baseCookieOptions(), maxAge: 0 };
  response.cookies.set(ACCESS_COOKIE, "", base);
  response.cookies.set(REFRESH_COOKIE, "", base);
  return response;
}

/** Reads the access token from the Authorization header, else the cookie. */
export async function readAccessToken(request) {
  const header = request?.headers?.get("authorization");
  if (header) {
    const [scheme, token] = header.split(" ");
    // The header wins so a mobile client is never confused by a stale cookie.
    if (scheme?.toLowerCase() === "bearer" && token) return token;
  }

  if (request?.cookies) return request.cookies.get(ACCESS_COOKIE)?.value ?? null;

  // No request object: we are in a Server Component, where `cookies()` reads
  // the incoming request directly.
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}

/** Mobile sends the refresh token in the body; the website sends the cookie. */
export function readRefreshToken(request, body) {
  return body?.refreshToken ?? request?.cookies?.get(REFRESH_COOKIE)?.value ?? null;
}
