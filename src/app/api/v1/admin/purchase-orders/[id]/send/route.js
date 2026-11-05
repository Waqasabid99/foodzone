import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { sendPurchaseOrder } from "@/server/services/purchase-order.service";
import { assertRecordAccess } from "@/server/purchasing/access";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "purchase_orders.send",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "purchase_order.send", entityType: "PurchaseOrder" },
  },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "purchaseOrder", params.id, "purchase_orders.send");
    return ok(await sendPurchaseOrder(params.id, auth));
  },
);
