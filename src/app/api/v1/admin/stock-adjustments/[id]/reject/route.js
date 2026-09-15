import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { closePurchaseOrderSchema } from "@/server/validation/inventory.schemas";
import { rejectAdjustment } from "@/server/services/stock-adjustment.service";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "stock_adjustments.approve",
    params: idParamSchema,
    body: closePurchaseOrderSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) =>
    ok(await rejectAdjustment(params.id, { reason: body?.reason ?? null, actor: auth })),
);
