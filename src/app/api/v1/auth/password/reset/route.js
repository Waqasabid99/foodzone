import { apiHandler, ok, clearSessionCookies, RateLimits } from "@/lib/api";
import { resetPasswordSchema } from "@/server/validation/schemas";
import { resetPassword } from "@/server/services/password.service";

/**
 * No session is returned: every credential was just invalidated, so the client
 * logs in with the new password. Cookies are cleared for the same reason.
 */
export const POST = apiHandler(
  { body: resetPasswordSchema, rateLimit: RateLimits.auth, scope: "auth:reset-password" },
  async ({ body }) => clearSessionCookies(ok(await resetPassword(body))),
);
