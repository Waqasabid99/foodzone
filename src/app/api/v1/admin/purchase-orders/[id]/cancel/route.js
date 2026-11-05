import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { closePurchaseOrderSchema } from "@/server/validation/inventory.schemas";
import { cancelPurchaseOrder } from "@/server/services/purchase-order.service";
import { assertRecordAccess } from "@/server/purchasing/access";

/**
 * Cancels an order.
 *
 * Refused once anything has been received: the goods exist and the supplier is
 * owed for them, so what is needed is a short close, not a cancellation that
 * pretends the delivery never happened.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "purchase_orders.cancel",
    params: idParamSchema,
    body: closePurchaseOrderSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => {
    await assertRecordAccess(auth, "purchaseOrder", params.id, "purchase_orders.cancel");
    return ok(await cancelPurchaseOrder(params.id, { reason: body?.reason ?? null, actor: auth }));
  },
);
