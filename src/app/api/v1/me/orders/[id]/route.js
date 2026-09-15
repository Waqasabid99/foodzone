import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getOwnOrder } from "@/server/services/order.service";

/**
 * Another customer's order returns NOT_FOUND rather than FORBIDDEN: confirming
 * an id exists would let someone enumerate other people's orders.
 */
export const GET = apiHandler(
  { auth: true, params: idParamSchema, rateLimit: RateLimits.read, scope: "me:orders" },
  async ({ auth, params }) => ok(await getOwnOrder({ id: params.id, userId: auth.userId })),
);
