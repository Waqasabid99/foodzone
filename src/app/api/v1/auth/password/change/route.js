import { apiHandler, ok, setSessionCookies, RateLimits } from "@/lib/api";
import { changePasswordSchema } from "@/server/validation/schemas";
import { changePassword } from "@/server/services/password.service";

/**
 * Signs out every other device and hands this one a fresh session, so changing
 * your password does not log you out of the app you changed it in.
 */
export const POST = apiHandler(
  { auth: true, body: changePasswordSchema, rateLimit: RateLimits.auth, scope: "auth:change-password" },
  async ({ auth, body, client, ipAddress, userAgent }) => {
    const session = await changePassword({
      principal: auth,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      client,
      ipAddress,
      userAgent,
    });
    return setSessionCookies(ok(session), session);
  },
);
