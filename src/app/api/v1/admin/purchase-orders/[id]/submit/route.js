import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { submitPurchaseOrder } from "@/server/services/purchase-order.service";
import { assertRecordAccess } from "@/server/purchasing/access";

/**
 * Hands a draft order to whoever approves the money.
 *
 * Gated on `create`, not `update`, because sending your own draft on is the
 * last step of raising it — not an edit of somebody else's. A role allowed to
 * raise an order and not to edit one (every stock and branch role is) would
 * otherwise leave its drafts stranded where no approver ever sees them, which
 * is a buy request that silently never happened. Expenses already pair the two
 * this way.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "purchase_orders.create",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "purchase_order.submit", entityType: "PurchaseOrder" },
  },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "purchaseOrder", params.id, "purchase_orders.create");
    return ok(await submitPurchaseOrder(params.id, auth));
  },
);
