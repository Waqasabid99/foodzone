import { apiHandler, ok, RateLimits } from "@/lib/api";
import { verifyEmailSchema } from "@/server/validation/schemas";
import { verifyEmail } from "@/server/services/auth.service";

export const POST = apiHandler(
  { auth: true, body: verifyEmailSchema, rateLimit: RateLimits.auth, scope: "auth:verify-email" },
  async ({ auth, body }) => ok(await verifyEmail({ userId: auth.userId, code: body.code })),
);
