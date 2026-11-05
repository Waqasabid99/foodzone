import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { setTemporaryPassword } from "@/server/services/user.service";

/**
 * Issues a temporary password for someone locked out with no reachable email.
 *
 * The password is in this response and nowhere else: it is not stored in
 * readable form and never emailed. Every session is revoked, and the account
 * can do nothing but choose its own password until it does.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "users.reset_password",
    params: idParamSchema,
    rateLimit: RateLimits.otp,
    scope: "admin:temporary-password",
    audit: { action: "user.temporary_password", entityType: "User" },
  },
  async ({ auth, params }) => ok(await setTemporaryPassword(params.id, auth)),
);
