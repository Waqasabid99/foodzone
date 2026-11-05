import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updatePurchaseOrderSchema } from "@/server/validation/inventory.schemas";
import { getPurchaseOrder, updatePurchaseOrder } from "@/server/services/purchase-order.service";
import { assertRecordAccess } from "@/server/purchasing/access";

export const GET = apiHandler(
  { auth: true, permissions: "purchase_orders.read", params: idParamSchema },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "purchaseOrder", params.id, "purchase_orders.read");
    return ok(await getPurchaseOrder(params.id));
  },
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
  async ({ params, body, auth }) => {
    await assertRecordAccess(auth, "purchaseOrder", params.id, "purchase_orders.update");
    return ok(await updatePurchaseOrder(params.id, body, auth));
  },
);
