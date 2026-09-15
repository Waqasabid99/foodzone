import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { approvePayout } from "@/server/services/driver-payout.service";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "driver_payouts.approve",
    params: idParamSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, auth }) => ok(await approvePayout({ payoutId: params.id, actor: auth })),
);
