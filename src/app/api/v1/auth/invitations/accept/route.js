import { apiHandler, ok, setSessionCookies, RateLimits } from "@/lib/api";
import { acceptInvitationSchema } from "@/server/validation/schemas";
import { acceptInvitation } from "@/server/services/user.service";

/** Staff set their own password here; the account activates on success. */
export const POST = apiHandler(
  { body: acceptInvitationSchema, rateLimit: RateLimits.auth, scope: "auth:accept-invitation" },
  async ({ body, client, ipAddress, userAgent }) => {
    const session = await acceptInvitation({ ...body, client, ipAddress, userAgent });
    return setSessionCookies(ok(session), session);
  },
);
