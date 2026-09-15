import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { orderNotesSchema } from "@/server/validation/ordering.schemas";
import { assertOrderAccess, updateOrderNotes } from "@/server/services/order.service";

/** The kitchen note above all — what the KDS puts on the ticket. */
export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "orders.update",
    params: idParamSchema,
    body: orderNotesSchema,
    rateLimit: RateLimits.write,
    audit: { action: "order.notes", entityType: "Order" },
  },
  async ({ auth, params, body }) => {
    await assertOrderAccess(auth, params.id, "orders.update");
    return ok(await updateOrderNotes({ orderId: params.id, ...body }));
  },
);
