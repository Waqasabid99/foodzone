import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { closePurchaseOrderSchema } from "@/server/validation/inventory.schemas";
import { rejectAdjustment } from "@/server/services/stock-adjustment.service";
import { assertRecordAccess } from "@/server/inventory/access";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "stock_adjustments.approve",
    params: idParamSchema,
    body: closePurchaseOrderSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => {
    await assertRecordAccess(auth, "adjustment", params.id, "stock_adjustments.approve");
    return ok(await rejectAdjustment(params.id, { reason: body?.reason ?? null, actor: auth }));
  },
);
