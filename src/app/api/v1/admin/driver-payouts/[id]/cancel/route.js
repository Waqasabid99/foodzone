import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { cancelPayout } from "@/server/services/driver-payout.service";
import { assertRecordAccess } from "@/server/delivery/access";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "driver_payouts.approve",
    params: idParamSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "driverPayout", params.id, "driver_payouts.approve");
    return ok(await cancelPayout({ payoutId: params.id, actor: auth }));
  },
);
