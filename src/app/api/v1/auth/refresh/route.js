import { apiHandler, ok, readRefreshToken, setSessionCookies, RateLimits } from "@/lib/api";
import { refreshSchema } from "@/server/validation/schemas";
import { refreshSession } from "@/server/services/auth.service";

export const POST = apiHandler(
  { body: refreshSchema, rateLimit: RateLimits.session, scope: "auth:refresh" },
  async ({ request, body, ipAddress, userAgent, client }) => {
    const session = await refreshSession({
      refreshToken: readRefreshToken(request, body),
      client,
      ipAddress,
      userAgent,
    });
    return setSessionCookies(ok(session), session);
  },
);
