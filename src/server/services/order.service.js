import { prisma } from "@/lib/prisma";
import { ApiError, assertBranchAccess, can, cursorArgs, toPage } from "@/lib/api";
import { withTransaction } from "@/server/utils/db";
import { enqueue } from "@/server/jobs/outbox";

/**
 * The order lifecycle.
 *
 * An order's status is a state machine, and it is enforced here rather than
 * left to whoever calls the API. Without a machine, a tablet in a busy kitchen
 * with a stale screen will happily move a delivered order back to preparing, or
 * cancel one that is already in a driver's bag — and every such move corrupts
 * reporting, payouts and the customer's tracking screen at once.
 *
 * Every transition is written to `OrderStatusEvent` with who did it, so the
 * question "why is this order in this state" always has an answer.
 */

/**
 * What each status may become next, per order type.
 *
 * `DELIVERY` is the only flow with a driver leg, and `DINE_IN`/`PICKUP` finish
 * at COMPLETED rather than DELIVERED. Keeping them apart stops a dine-in order
 * being marked out for delivery.
 */
const TRANSITIONS = {
  DELIVERY: {
    PENDING: ["CONFIRMED", "REJECTED", "CANCELLED"],
    CONFIRMED: ["PREPARING", "CANCELLED"],
    PREPARING: ["READY", "CANCELLED"],
    READY: ["OUT_FOR_DELIVERY", "CANCELLED"],
    OUT_FOR_DELIVERY: ["DELIVERED", "CANCELLED"],
    DELIVERED: ["COMPLETED", "REFUNDED"],
    COMPLETED: ["REFUNDED"],
    CANCELLED: [],
    REJECTED: [],
    REFUNDED: [],
    DRAFT: ["PENDING", "CANCELLED"],
  },
  PICKUP: {
    PENDING: ["CONFIRMED", "REJECTED", "CANCELLED"],
    CONFIRMED: ["PREPARING", "CANCELLED"],
    PREPARING: ["READY", "CANCELLED"],
    READY: ["COMPLETED", "CANCELLED"],
    COMPLETED: ["REFUNDED"],
    CANCELLED: [],
    REJECTED: [],
    REFUNDED: [],
    DRAFT: ["PENDING", "CANCELLED"],
  },
  DINE_IN: {
    PENDING: ["CONFIRMED", "REJECTED", "CANCELLED"],
    CONFIRMED: ["PREPARING", "CANCELLED"],
    PREPARING: ["READY", "CANCELLED"],
    READY: ["COMPLETED", "CANCELLED"],
    COMPLETED: ["REFUNDED"],
    CANCELLED: [],
    REJECTED: [],
    REFUNDED: [],
    DRAFT: ["PENDING", "CANCELLED"],
  },
};

/** Statuses after which nothing more happens. */
export const TERMINAL_STATUSES = ["COMPLETED", "CANCELLED", "REJECTED", "REFUNDED"];

/** A customer may still call it off up to here — after this the food is made. */
const CUSTOMER_CANCELLABLE = ["PENDING", "CONFIRMED"];

export function allowedTransitions(type, status) {
  return TRANSITIONS[type]?.[status] ?? [];
}

export function canTransition(type, from, to) {
  return allowedTransitions(type, from).includes(to);
}

/** Timestamp columns that a status change also stamps. */
const STAMPS = {
  CONFIRMED: "confirmedAt",
  READY: "preparedAt",
  DELIVERED: "completedAt",
  COMPLETED: "completedAt",
  CANCELLED: "cancelledAt",
  REJECTED: "cancelledAt",
};

const ITEM_SELECT = {
  id: true,
  productId: true,
  variantId: true,
  nameSnapshot: true,
  skuSnapshot: true,
  quantity: true,
  unitPrice: true,
  modifierTotal: true,
  discountAmount: true,
  taxRate: true,
  taxAmount: true,
  lineTotal: true,
  notes: true,
  status: true,
  stationId: true,
  parentItemId: true,
  preparedAt: true,
  cancelledAt: true,
  cancelReason: true,
  modifiers: {
    select: { id: true, optionId: true, groupNameSnapshot: true, nameSnapshot: true, quantity: true, priceDelta: true },
  },
};

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  branchId: true,
  userId: true,
  guestName: true,
  guestPhone: true,
  guestEmail: true,
  channel: true,
  type: true,
  status: true,
  paymentState: true,
  addressId: true,
  addressSnapshot: true,
  tableId: true,
  guestCount: true,
  currency: true,
  subtotal: true,
  discountTotal: true,
  taxTotal: true,
  deliveryFee: true,
  packagingFee: true,
  serviceCharge: true,
  tipAmount: true,
  roundOff: true,
  grandTotal: true,
  paidTotal: true,
  refundedTotal: true,
  customerNote: true,
  kitchenNote: true,
  cancelReason: true,
  externalRef: true,
  placedAt: true,
  confirmedAt: true,
  promisedAt: true,
  preparedAt: true,
  completedAt: true,
  cancelledAt: true,
  branch: { select: { id: true, code: true, name: true, phone: true, timezone: true } },
  table: { select: { id: true, name: true, area: true } },
};

const DETAIL_SELECT = {
  ...ORDER_SELECT,
  items: { select: ITEM_SELECT, orderBy: { id: "asc" } },
  taxLines: { select: { id: true, name: true, rate: true, taxableAmount: true, amount: true } },
  discounts: { select: { id: true, source: true, label: true, amount: true, reason: true } },
  statusHistory: {
    select: { id: true, fromStatus: true, toStatus: true, note: true, changedById: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  },
  invoice: { select: { id: true, invoiceNumber: true, issuedAt: true, isVoid: true, totalAmount: true } },
};

/**
 * Nests a combo's children under their parent, so a client renders
 * "Meal deal — includes: pizza, drink" without reassembling the tree itself.
 */
function nestComboLines(items = []) {
  const children = new Map();
  for (const item of items) {
    if (!item.parentItemId) continue;
    const list = children.get(item.parentItemId) ?? [];
    list.push(item);
    children.set(item.parentItemId, list);
  }

  return items
    .filter((item) => !item.parentItemId)
    .map((item) => ({ ...item, includes: children.get(item.id) ?? [] }));
}

function shapeOrder(order) {
  if (!order) return order;
  return {
    ...order,
    ...(order.items ? { items: nestComboLines(order.items) } : {}),
    ...(order.type ? { nextStatuses: allowedTransitions(order.type, order.status) } : {}),
    isTerminal: TERMINAL_STATUSES.includes(order.status),
  };
}

// --- reads ------------------------------------------------------------------

export async function listOrders({
  branchId,
  userId,
  status,
  type,
  channel,
  paymentState,
  search,
  from,
  to,
  limit = 20,
  cursor,
} = {}) {
  const rows = await prisma.order.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(userId ? { userId } : {}),
      ...(status ? { status: Array.isArray(status) ? { in: status } : status } : {}),
      ...(type ? { type } : {}),
      ...(channel ? { channel } : {}),
      ...(paymentState ? { paymentState } : {}),
      ...(from || to ? { placedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(search
        ? {
            OR: [
              { orderNumber: { contains: search, mode: "insensitive" } },
              { guestName: { contains: search, mode: "insensitive" } },
              { guestPhone: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: { ...ORDER_SELECT, _count: { select: { items: true } } },
    orderBy: [{ placedAt: "desc" }, { id: "desc" }],
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);
  return {
    ...page,
    items: page.items.map(({ _count, ...order }) => ({ ...shapeOrder(order), itemCount: _count.items })),
  };
}

export async function getOrder(id) {
  const order = await prisma.order.findUnique({ where: { id }, select: DETAIL_SELECT });
  if (!order) throw ApiError.notFound("Order not found");
  return shapeOrder(order);
}

/**
 * The customer-facing view.
 *
 * Another customer's order returns NOT_FOUND rather than FORBIDDEN: confirming
 * an id exists would let someone enumerate other people's orders.
 */
export async function getOwnOrder({ id, userId }) {
  const order = await prisma.order.findFirst({ where: { id, userId }, select: DETAIL_SELECT });
  if (!order) throw ApiError.notFound("Order not found");
  return shapeOrder(order);
}

/**
 * Tracking, by order number.
 *
 * Deliberately narrow: status, timings and where it is — never prices, the
 * customer's details or internal notes. A tracking link gets forwarded, pasted
 * into group chats and screenshotted, so it carries only what a courier at the
 * door would need.
 */
export async function trackOrder({ orderNumber, userId = null, phone = null }) {
  const order = await prisma.order.findUnique({
    where: { orderNumber },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      type: true,
      placedAt: true,
      confirmedAt: true,
      promisedAt: true,
      preparedAt: true,
      completedAt: true,
      userId: true,
      guestPhone: true,
      branch: { select: { name: true, phone: true, timezone: true } },
      statusHistory: { select: { toStatus: true, createdAt: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) throw ApiError.notFound("Order not found");

  // An order number is short and guessable, so it alone is not enough: the
  // caller must own the order or know the phone number on it.
  const owns = userId && order.userId === userId;
  const matchesPhone = phone && order.guestPhone && order.guestPhone.replace(/\D/g, "").endsWith(phone.replace(/\D/g, "").slice(-6));
  if (!owns && !matchesPhone) throw ApiError.notFound("Order not found");

  return {
    orderNumber: order.orderNumber,
    status: order.status,
    type: order.type,
    branch: order.branch,
    placedAt: order.placedAt,
    confirmedAt: order.confirmedAt,
    promisedAt: order.promisedAt,
    preparedAt: order.preparedAt,
    completedAt: order.completedAt,
    isTerminal: TERMINAL_STATUSES.includes(order.status),
    history: order.statusHistory,
  };
}

/** Order id in, branch permission check done, branch id out. */
export async function assertOrderAccess(principal, orderId, permissionKey) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { branchId: true } });
  if (!order) throw ApiError.notFound("Order not found");

  // A regional manager with `orders.read_all_branches` is not pinned to one.
  if (permissionKey === "orders.read" && can(principal, "orders.read_all_branches")) {
    return order.branchId;
  }

  assertBranchAccess(principal, order.branchId, permissionKey);
  return order.branchId;
}

// --- transitions ------------------------------------------------------------

/**
 * Moves an order to a new status.
 *
 * The guard is the whole point: an illegal move is a 409 naming what *is*
 * allowed, so a client with a stale screen can correct itself instead of
 * guessing.
 */
export async function changeOrderStatus({ orderId, toStatus, note = null, actorId = null }) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, type: true, status: true, orderNumber: true, userId: true },
  });
  if (!order) throw ApiError.notFound("Order not found");

  if (order.status === toStatus) {
    // Idempotent: two taps on a kitchen tablet must not be an error.
    return getOrder(orderId);
  }

  if (!canTransition(order.type, order.status, toStatus)) {
    throw ApiError.conflict(`A ${order.type} order cannot go from ${order.status} to ${toStatus}`, {
      from: order.status,
      to: toStatus,
      allowed: allowedTransitions(order.type, order.status),
    });
  }

  await withTransaction(async (tx) => {
    const stamp = STAMPS[toStatus];

    await tx.order.update({
      where: { id: orderId },
      data: { status: toStatus, ...(stamp ? { [stamp]: new Date() } : {}) },
    });

    await tx.orderStatusEvent.create({
      data: { orderId, fromStatus: order.status, toStatus, note, changedById: actorId },
    });

    // Food that is ready has been made; the kitchen queue should reflect that
    // without someone tapping every line.
    if (toStatus === "READY") {
      await tx.orderItem.updateMany({
        where: { orderId, status: { in: ["QUEUED", "PREPARING"] } },
        data: { status: "READY", preparedAt: new Date() },
      });
    }
    if (toStatus === "PREPARING") {
      await tx.orderItem.updateMany({ where: { orderId, status: "QUEUED" }, data: { status: "PREPARING" } });
    }
  });

  await enqueue({
    eventType: "order.status_changed",
    payload: { orderId, fromStatus: order.status, toStatus },
  });

  return getOrder(orderId);
}

/**
 * Cancels an order.
 *
 * A customer may call it off only while nothing has been cooked; after that it
 * takes staff, who hold `orders.cancel`. The rule lives here rather than in the
 * route so both the web and the app inherit it.
 */
export async function cancelOrder({ orderId, reason, actorId = null, byCustomer = false }) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, type: true, status: true, userId: true },
  });
  if (!order) throw ApiError.notFound("Order not found");

  if (TERMINAL_STATUSES.includes(order.status)) {
    throw ApiError.conflict(`This order is already ${order.status.toLowerCase()}`);
  }

  if (byCustomer && !CUSTOMER_CANCELLABLE.includes(order.status)) {
    throw ApiError.conflict(
      "This order is already being prepared. Call the branch if you need to cancel it.",
      { status: order.status },
    );
  }

  if (!canTransition(order.type, order.status, "CANCELLED")) {
    throw ApiError.conflict(`A ${order.type} order cannot be cancelled from ${order.status}`, {
      allowed: allowedTransitions(order.type, order.status),
    });
  }

  await withTransaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason, cancelledById: actorId },
    });
    await tx.orderStatusEvent.create({
      data: { orderId, fromStatus: order.status, toStatus: "CANCELLED", note: reason, changedById: actorId },
    });
    await tx.orderItem.updateMany({
      where: { orderId, status: { not: "CANCELLED" } },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
  });

  await enqueue({
    eventType: "order.cancelled",
    payload: { orderId, reason },
  });

  return getOrder(orderId);
}

/** Staff notes on a live order — the kitchen note the KDS shows, above all. */
export async function updateOrderNotes({ orderId, kitchenNote, customerNote }) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, status: true } });
  if (!order) throw ApiError.notFound("Order not found");
  if (TERMINAL_STATUSES.includes(order.status)) {
    throw ApiError.conflict("A finished order cannot be edited");
  }

  await prisma.order.update({
    where: { id: orderId },
    data: {
      ...(kitchenNote !== undefined ? { kitchenNote } : {}),
      ...(customerNote !== undefined ? { customerNote } : {}),
    },
  });

  return getOrder(orderId);
}

export { ORDER_SELECT, DETAIL_SELECT, shapeOrder, nestComboLines };
