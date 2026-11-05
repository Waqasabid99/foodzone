/**
 * The session cookie names, alone in a module with no imports.
 *
 * The proxy needs them and runs in a restricted runtime, so it must not pull in
 * `cookies.js` — that reaches `next/headers` and the JWT library, neither of
 * which belongs in a request filter that only looks at whether a cookie exists.
 */
export const ACCESS_COOKIE = "fz_access";
export const REFRESH_COOKIE = "fz_refresh";
