import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { approvePurchaseOrder } from "@/server/services/purchase-order.service";
import { assertRecordAccess } from "@/server/purchasing/access";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "purchase_orders.approve",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "purchase_order.approve", entityType: "PurchaseOrder" },
  },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "purchaseOrder", params.id, "purchase_orders.approve");
    return ok(await approvePurchaseOrder(params.id, auth));
  },
);
