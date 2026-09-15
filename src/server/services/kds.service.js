import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { withTransaction } from "@/server/utils/db";
import { changeOrderStatus } from "@/server/services/order.service";

/**
 * The kitchen display.
 *
 * A screen on a wall in a hot, busy room. Everything here is shaped by that:
 * the queue is ordered oldest-first because tickets are worked in the order
 * they arrived, it carries the elapsed time so a late ticket is obvious at a
 * glance, and item status changes are idempotent because a chef with flour on
 * their hands taps twice.
 *
 * Tickets are filtered by station so the grill screen never shows desserts.
 * A product with no station appears on every station's queue rather than
 * nowhere — an unrouted item that silently never gets cooked is far worse than
 * one that appears twice.
 */

/** Statuses whose food still has to be made. */
const ACTIVE_ORDER_STATUSES = ["CONFIRMED", "PREPARING", "READY"];
const ACTIVE_ITEM_STATUSES = ["QUEUED", "PREPARING"];

const ITEM_TRANSITIONS = {
  QUEUED: ["PREPARING", "READY", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["SERVED", "PREPARING"],
  SERVED: [],
  CANCELLED: [],
};

export function canTransitionItem(from, to) {
  return (ITEM_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * The station queue.
 *
 * One query for the orders and their items — a per-ticket query would be a
 * hundred round trips on a Friday night.
 */
export async function stationQueue({ branchId, stationId = null, includeReady = true, limit = 50 }) {
  const orders = await prisma.order.findMany({
    where: {
      branchId,
      status: { in: includeReady ? ACTIVE_ORDER_STATUSES : ["CONFIRMED", "PREPARING"] },
    },
    select: {
      id: true,
      orderNumber: true,
      type: true,
      status: true,
      channel: true,
      placedAt: true,
      promisedAt: true,
      confirmedAt: true,
      kitchenNote: true,
      guestCount: true,
      table: { select: { id: true, name: true, area: true } },
      items: {
        where: {
          status: { in: includeReady ? [...ACTIVE_ITEM_STATUSES, "READY"] : ACTIVE_ITEM_STATUSES },
          // A combo's children are printed under their parent, not as tickets
          // of their own.
          parentItemId: null,
        },
        select: {
          id: true,
          nameSnapshot: true,
          quantity: true,
          notes: true,
          status: true,
          stationId: true,
          preparedAt: true,
          modifiers: { select: { groupNameSnapshot: true, nameSnapshot: true, quantity: true } },
          children: { select: { id: true, nameSnapshot: true, quantity: true, status: true } },
        },
        orderBy: { id: "asc" },
      },
    },
    // Oldest first: a kitchen works the queue in the order it arrived.
    orderBy: { placedAt: "asc" },
    take: limit,
  });

  const now = Date.now();

  return orders
    .map((order) => ({
      ...order,
      // An unrouted item (no station) shows everywhere rather than nowhere.
      items: stationId
        ? order.items.filter((item) => item.stationId === stationId || item.stationId === null)
        : order.items,
      waitingMinutes: Math.floor((now - new Date(order.placedAt).getTime()) / 60_000),
      isLate: order.promisedAt ? new Date(order.promisedAt).getTime() < now : false,
    }))
    .filter((order) => order.items.length > 0);
}

/**
 * Marks one line preparing, ready, served or cancelled.
 *
 * Advancing the last outstanding line advances the order itself: nobody in a
 * kitchen should have to remember to tap the ticket *and* the order, and an
 * order sitting in PREPARING with every line ready is exactly the kind of
 * stale state that loses a customer's food.
 */
export async function setItemStatus({ itemId, status, actorId = null, reason = null }) {
  const item = await prisma.orderItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      status: true,
      orderId: true,
      parentItemId: true,
      order: { select: { id: true, branchId: true, status: true, type: true } },
    },
  });
  if (!item) throw ApiError.notFound("Order item not found");

  // Idempotent: a double tap is not an error.
  if (item.status === status) return { itemId, status, orderStatus: item.order.status, changed: false };

  if (!canTransitionItem(item.status, status)) {
    throw ApiError.conflict(`An item cannot go from ${item.status} to ${status}`, {
      allowed: ITEM_TRANSITIONS[item.status] ?? [],
    });
  }

  const now = new Date();

  await withTransaction(async (tx) => {
    await tx.orderItem.update({
      where: { id: itemId },
      data: {
        status,
        ...(status === "READY" ? { preparedAt: now } : {}),
        ...(status === "CANCELLED" ? { cancelledAt: now, cancelReason: reason } : {}),
      },
    });

    // A combo's children follow their parent — they are one dish.
    await tx.orderItem.updateMany({ where: { parentItemId: itemId }, data: { status } });
  });

  const orderStatus = await advanceOrderFromItems({ orderId: item.orderId, actorId });

  return { itemId, status, orderStatus, changed: true };
}

/**
 * Moves the order on when its lines say so.
 *
 * Returns the order's status either way, so a KDS can re-render from one
 * response rather than following up with a fetch.
 */
async function advanceOrderFromItems({ orderId, actorId }) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, type: true },
  });
  if (!order) return null;

  const items = await prisma.orderItem.findMany({
    where: { orderId, parentItemId: null },
    select: { status: true },
  });

  const live = items.filter((item) => item.status !== "CANCELLED");
  if (!live.length) return order.status;

  const allReady = live.every((item) => ["READY", "SERVED"].includes(item.status));
  const anyStarted = live.some((item) => item.status !== "QUEUED");

  if (allReady && ["CONFIRMED", "PREPARING"].includes(order.status)) {
    // Bumping a whole ticket in one action takes an order straight from
    // CONFIRMED to READY. The machine has no such edge — and should not, since
    // every order really does pass through preparing — so walk it through
    // rather than leaving the order stuck a step behind its own food.
    if (order.status === "CONFIRMED") {
      await changeOrderStatus({ orderId, toStatus: "PREPARING", actorId, note: "Kitchen started" });
    }
    const updated = await changeOrderStatus({ orderId, toStatus: "READY", actorId, note: "All items ready" });
    return updated.status;
  }

  if (anyStarted && order.status === "CONFIRMED") {
    const updated = await changeOrderStatus({ orderId, toStatus: "PREPARING", actorId, note: "Kitchen started" });
    return updated.status;
  }

  return order.status;
}

/** Bumps a whole ticket at once — the button a chef actually presses. */
export async function bumpOrder({ orderId, status = "READY", actorId = null }) {
  const items = await prisma.orderItem.findMany({
    where: { orderId, parentItemId: null, status: { in: ACTIVE_ITEM_STATUSES } },
    select: { id: true, status: true },
  });

  for (const item of items) {
    if (canTransitionItem(item.status, status)) {
      await setItemStatus({ itemId: item.id, status, actorId });
    }
  }

  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
  return { orderId, bumped: items.length, orderStatus: order?.status ?? null };
}

/** How the kitchen is doing right now — the number on the wall. */
export async function kitchenSummary({ branchId }) {
  const [queued, preparing, ready, orders] = await Promise.all([
    prisma.orderItem.count({ where: { order: { branchId }, status: "QUEUED" } }),
    prisma.orderItem.count({ where: { order: { branchId }, status: "PREPARING" } }),
    prisma.orderItem.count({ where: { order: { branchId }, status: "READY" } }),
    prisma.order.findMany({
      where: { branchId, status: { in: ACTIVE_ORDER_STATUSES } },
      select: { promisedAt: true },
    }),
  ]);

  const now = Date.now();

  return {
    branchId,
    items: { queued, preparing, ready },
    activeOrders: orders.length,
    lateOrders: orders.filter((order) => order.promisedAt && new Date(order.promisedAt).getTime() < now).length,
  };
}
