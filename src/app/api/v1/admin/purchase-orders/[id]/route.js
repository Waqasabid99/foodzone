import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updatePurchaseOrderSchema } from "@/server/validation/inventory.schemas";
import { getPurchaseOrder, updatePurchaseOrder } from "@/server/services/purchase-order.service";

export const GET = apiHandler(
  { auth: true, permissions: "purchase_orders.read", params: idParamSchema },
  async ({ params }) => ok(await getPurchaseOrder(params.id)),
);

/** Editable only while draft or pending — after approval it is what was signed off. */
export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "purchase_orders.update",
    params: idParamSchema,
    body: updatePurchaseOrderSchema,
    rateLimit: RateLimits.write,
    audit: { action: "purchase_order.update", entityType: "PurchaseOrder" },
  },
  async ({ params, body, auth }) => ok(await updatePurchaseOrder(params.id, body, auth)),
);
