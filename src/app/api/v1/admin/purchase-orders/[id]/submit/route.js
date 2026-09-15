import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { submitPurchaseOrder } from "@/server/services/purchase-order.service";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "purchase_orders.update",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "purchase_order.submit", entityType: "PurchaseOrder" },
  },
  async ({ params, auth }) => ok(await submitPurchaseOrder(params.id, auth)),
);
