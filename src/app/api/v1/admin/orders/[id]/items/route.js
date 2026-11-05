import { apiHandler, created, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { addCourseSchema } from "@/server/validation/ordering.schemas";
import { assertOrderAccess } from "@/server/services/order.service";
import { addCourse } from "@/server/services/order-items.service";

/**
 * Adds a round to an order that is already on a table.
 *
 * One bill, several courses: the lines join the order the table already has,
 * and go to the kitchen as their own ticket with their own clock. Priced at
 * today's menu with offers switched off — a coupon is awarded once, when the
 * order is placed, not again every time somebody orders another drink.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "orders.edit_items",
    params: idParamSchema,
    body: addCourseSchema,
    rateLimit: RateLimits.write,
    // Audited in the service, which knows the course number and the amount.
  },
  async ({ auth, params, body }) => {
    await assertOrderAccess(auth, params.id, "orders.edit_items");
    return created(await addCourse({ orderId: params.id, items: body.items, actorId: auth.userId }));
  },
);
