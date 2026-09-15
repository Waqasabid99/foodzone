import { apiHandler, ok, clearSessionCookies, readRefreshToken, optionalAuth } from "@/lib/api";
import { logoutSchema } from "@/server/validation/schemas";
import { logout } from "@/server/services/auth.service";

/**
 * Unauthenticated on purpose: an expired access token must still be able to
 * end its session, otherwise a stale client can never log out cleanly.
 */
export const POST = apiHandler({ body: logoutSchema }, async ({ request, body }) => {
  const principal = await optionalAuth(request);

  const result = await logout({
    refreshToken: readRefreshToken(request, body),
    userId: principal?.userId,
    allDevices: body.allDevices,
  });

  return clearSessionCookies(ok(result));
});
