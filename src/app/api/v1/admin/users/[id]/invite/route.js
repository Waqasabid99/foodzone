import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { resendInvitation } from "@/server/services/user.service";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "users.create",
    params: idParamSchema,
    rateLimit: RateLimits.otp,
    scope: "admin:resend-invite",
    audit: { action: "user.invite_resend", entityType: "User" },
  },
  async ({ auth, params }) => ok(await resendInvitation({ userId: params.id }, auth)),
);
