import { apiHandler, created, paginated, RateLimits } from "@/lib/api";
import { orderQuerySchema, staffOrderSchema } from "@/server/validation/ordering.schemas";
import { changeOrderStatus, listOrders, getOrder } from "@/server/services/order.service";
import { placeOrder } from "@/server/services/checkout.service";
import { orderScope } from "@/server/ordering/access";

export const GET = apiHandler(
  { auth: true, permissions: "orders.read", query: orderQuerySchema, branch: "query" },
  async ({ query, auth }) => {
    const { items, nextCursor, limit } = await listOrders({ ...query, scope: orderScope(auth) });
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
 *
 * And it comes out accepted. "New, awaiting confirmation" is a state that
 * means something for an order that arrived from the website — somebody at the
 * shop has to agree to cook it. An order a member of staff has just typed in,
 * with the customer standing there, has already been agreed to by the only
 * person who could agree to it, so asking them to press Accept is a tap that
 * confirms their own decision to themselves. `QR` is excluded: a customer
 * ordering from their table typed it themselves, and nobody from the shop has
 * seen it yet.
 */
const SELF_ACCEPTING = ["POS", "PHONE"];

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

    if (SELF_ACCEPTING.includes(body.channel)) {
      // Through the normal transition, so the history, the timestamp and the
      // outbox event are the same ones a pressed Accept would have produced.
      // A failure here leaves an order somebody can accept by hand, which is
      // strictly better than failing a sale that has already been rung up.
      const accepted = await changeOrderStatus({
        orderId,
        toStatus: "CONFIRMED",
        note: "Taken by staff, accepted on entry",
        actorId: auth.userId,
      }).catch(() => null);
      if (accepted) return created(accepted);
    }

    return created(await getOrder(orderId));
  },
);
