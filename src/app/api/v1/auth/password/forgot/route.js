import { apiHandler, ok, RateLimits } from "@/lib/api";
import { forgotPasswordSchema } from "@/server/validation/schemas";
import { requestPasswordReset } from "@/server/services/password.service";

/** Always reports success — see the service for why. */
export const POST = apiHandler(
  { body: forgotPasswordSchema, rateLimit: RateLimits.otp, scope: "auth:forgot-password" },
  async ({ body }) => ok(await requestPasswordReset(body)),
);
