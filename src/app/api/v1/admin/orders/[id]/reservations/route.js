import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { assertOrderAccess } from "@/server/services/order.service";
import { reservationsForOrder } from "@/server/services/reservation.service";

/**
 * What stock this order is holding, and what became of it.
 *
 * Needed because a refusal at the till is otherwise unanswerable. "We cannot
 * make that right now" is the correct thing to tell a customer and useless to
 * the person who has to decide what to do about it — this is where they find
 * out that nine portions are on the shelf and eight orders are ahead of them.
 *
 * Behind `stock.read` rather than `orders.read`: the order is the question but
 * ingredient quantities are the answer, and a waiter who may look at a bill
 * has no business reading the store room.
 */
export const GET = apiHandler(
  { auth: true, permissions: "stock.read", params: idParamSchema },
  async ({ auth, params }) => {
    await assertOrderAccess(auth, params.id, "orders.read");
    return ok(await reservationsForOrder(params.id));
  },
);
