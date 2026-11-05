import { prisma } from "@/lib/prisma";
import { FULFILLED_STATUSES } from "@/lib/order-status";

/**
 * What the customer's own screens need beyond the services themselves.
 */

const REVIEWABLE = FULFILLED_STATUSES;

/**
 * Orders this person could still review, and the items on them.
 *
 * There is no "reviewable items" endpoint, because a review is written
 * against an order rather than selected from a queue. The screen still needs
 * the queue, though: nobody opens their account meaning to review something,
 * so an empty review page with a "write one" button gets used by nobody. This
 * assembles the prompt instead — what you ate, and whether you have said
 * anything about it.
 *
 * An order already reviewed as a whole drops out; one where only some items
 * have been reviewed keeps the rest.
 */
export async function reviewableOrders({ userId, take = 10 }) {
  const orders = await prisma.order.findMany({
    where: { userId, status: { in: REVIEWABLE } },
    select: {
      id: true,
      orderNumber: true,
      completedAt: true,
      placedAt: true,
      items: {
        where: { parentItemId: null },
        select: { id: true, productId: true, nameSnapshot: true },
      },
    },
    orderBy: { placedAt: "desc" },
    take,
  });
  if (!orders.length) return [];

  const reviews = await prisma.review.findMany({
    where: { userId, orderId: { in: orders.map((order) => order.id) } },
    select: { orderId: true, productId: true },
  });

  const seen = new Set(reviews.map((row) => `${row.orderId}:${row.productId ?? ""}`));

  return orders
    .map((order) => ({
      ...order,
      // The order itself, reviewed as a whole.
      reviewedOverall: seen.has(`${order.id}:`),
      items: order.items.filter((item) => item.productId && !seen.has(`${order.id}:${item.productId}`)),
    }))
    .filter((order) => !order.reviewedOverall || order.items.length);
}
