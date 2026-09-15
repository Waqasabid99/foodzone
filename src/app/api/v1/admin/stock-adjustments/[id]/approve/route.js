import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { approveAdjustment } from "@/server/services/stock-adjustment.service";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "stock_adjustments.approve",
    params: idParamSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, auth }) => ok(await approveAdjustment(params.id, auth)),
);
