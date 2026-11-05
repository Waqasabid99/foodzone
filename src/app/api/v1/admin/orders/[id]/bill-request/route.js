import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { assertOrderAccess, clearBillRequest, requestBill } from "@/server/services/order.service";

/**
 * The table has asked for the bill.
 *
 * What a waiter does instead of taking the money: it puts the table in front
 * of whoever is on the till, who settles it. Nothing about the order changes —
 * not its status, not its total, not what the kitchen sees.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "orders.request_bill",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "order.bill_requested", entityType: "Order", entityId: ({ params }) => params.id },
  },
  async ({ auth, params }) => {
    await assertOrderAccess(auth, params.id, "orders.request_bill");
    return ok(await requestBill({ orderId: params.id, actorId: auth.userId }));
  },
);

/**
 * Takes it back off the till's list.
 *
 * Held by the till as well as the floor: the commonest reason to clear one is
 * that it was asked for by mistake, or that the money arrived some other way,
 * and the person who finds that out is usually the one at the register.
 */
export const DELETE = apiHandler(
  {
    auth: true,
    permissions: ["orders.request_bill", "payments.capture"],
    anyPermission: true,
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "order.bill_request_cleared", entityType: "Order", entityId: ({ params }) => params.id },
  },
  async ({ auth, params }) => {
    await assertOrderAccess(auth, params.id, "orders.read");
    return ok(await clearBillRequest({ orderId: params.id }));
  },
);
