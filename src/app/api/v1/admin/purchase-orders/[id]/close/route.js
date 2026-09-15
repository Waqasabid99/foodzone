import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { closePurchaseOrderSchema } from "@/server/validation/inventory.schemas";
import { closePurchaseOrder } from "@/server/services/purchase-order.service";

/** The honest end for a delivery that will never be completed. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "purchase_orders.cancel",
    params: idParamSchema,
    body: closePurchaseOrderSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) =>
    ok(await closePurchaseOrder(params.id, { reason: body?.reason ?? null, actor: auth })),
);
