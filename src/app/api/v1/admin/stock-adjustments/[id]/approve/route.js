import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { approveAdjustment } from "@/server/services/stock-adjustment.service";
import { assertRecordAccess } from "@/server/inventory/access";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "stock_adjustments.approve",
    params: idParamSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "adjustment", params.id, "stock_adjustments.approve");
    return ok(await approveAdjustment(params.id, auth));
  },
);
