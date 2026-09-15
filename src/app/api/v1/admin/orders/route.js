import { apiHandler, created, paginated, RateLimits } from "@/lib/api";
import { orderQuerySchema, staffOrderSchema } from "@/server/validation/ordering.schemas";
import { listOrders, getOrder } from "@/server/services/order.service";
import { placeOrder } from "@/server/services/checkout.service";

export const GET = apiHandler(
  { auth: true, permissions: "orders.read", query: orderQuerySchema, branch: "query" },
  async ({ query }) => {
    const { items, nextCursor, limit } = await listOrders(query);
    return paginated(items, { nextCursor, limit });
  },
);

/**
 * Staff order entry — the counter, the phone and the table.
 *
 * Routed through the same `placeOrder` as customer checkout, so pricing,
 * availability and the branch guards are identical. The only difference is who
 * may omit an account: a walk-in has no login, so their name and phone are
 * captured on the order instead.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "orders.create",
    body: staffOrderSchema,
    branch: "body",
    rateLimit: RateLimits.write,
    audit: { action: "order.create", entityType: "Order", entityId: ({ result }) => result?.id ?? null },
  },
  async ({ auth, body }) => {
    const orderId = await placeOrder({
      branchId: body.branchId,
      type: body.type,
      channel: body.channel,
      items: body.items,
      userId: body.userId ?? null,
      guest: body.guest ?? null,
      addressId: body.addressId ?? null,
      tableId: body.tableId ?? null,
      guestCount: body.guestCount ?? null,
      customerNote: body.customerNote ?? null,
      kitchenNote: body.kitchenNote ?? null,
      tipAmount: body.tipAmount,
      couponCode: body.couponCode ?? null,
      placedById: auth.userId,
    });

    return created(await getOrder(orderId));
  },
);
