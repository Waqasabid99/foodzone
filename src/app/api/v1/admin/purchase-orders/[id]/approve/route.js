import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { approvePurchaseOrder } from "@/server/services/purchase-order.service";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "purchase_orders.approve",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "purchase_order.approve", entityType: "PurchaseOrder" },
  },
  async ({ params, auth }) => ok(await approvePurchaseOrder(params.id, auth)),
);
