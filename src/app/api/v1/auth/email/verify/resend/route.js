import { apiHandler, ok, ApiError, RateLimits } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { sendVerificationCode } from "@/server/services/auth.service";

/**
 * Throttled twice over: the `otp` preset caps requests per hour, and the
 * credential-token service enforces a per-user cooldown between sends. The
 * second is the one that survives a restart.
 */
export const POST = apiHandler(
  { auth: true, rateLimit: RateLimits.otp, scope: "auth:verify-email-resend" },
  async ({ auth }) => {
    const user = await prisma.user.findFirst({ where: { id: auth.userId, deletedAt: null } });
    if (!user) throw ApiError.unauthorized();

    return ok(await sendVerificationCode({ user }));
  },
);
