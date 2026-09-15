import { apiHandler, paginated, RateLimits } from "@/lib/api";
import { myOrderQuerySchema } from "@/server/validation/ordering.schemas";
import { listOrders } from "@/server/services/order.service";

/** The customer's own order history. */
export const GET = apiHandler(
  { auth: true, query: myOrderQuerySchema, rateLimit: RateLimits.read, scope: "me:orders" },
  async ({ auth, query }) => {
    const { items, nextCursor, limit } = await listOrders({ ...query, userId: auth.userId });
    return paginated(items, { nextCursor, limit });
  },
);
