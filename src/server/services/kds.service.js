import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { withTransaction } from "@/server/utils/db";
import { changeOrderStatus } from "@/server/services/order.service";
import { recordAudit } from "@/server/utils/audit";

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
      // A ticket the kitchen has set aside is off their board until somebody
      // decides what happens to it. The order is untouched and still owed —
      // this is a view, not a state.
      setAsideAt: null,
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
          course: true,
          firedAt: true,
          // Named, so a line on the unfiltered board says where it is made.
          station: { select: { name: true } },
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
    .flatMap((order) =>
      // An unrouted item (no station) shows everywhere rather than nowhere.
      asTickets(
        order,
        stationId
          ? order.items.filter((item) => item.stationId === stationId || item.stationId === null)
          : order.items,
        now,
      ),
    )
    .filter((ticket) => ticket.items.length > 0)
    // Oldest first again, across courses: a second round fired ten minutes ago
    // belongs behind the ticket that has been up for twenty, not behind every
    // line of the order it happens to share a bill with.
    .sort((a, b) => a.firedAt - b.firedAt);
}

/**
 * One ticket per course.
 *
 * A round ordered later is its own piece of work with its own clock. Hanging
 * it on the original ticket would reopen something the kitchen had finished
 * and paint it with that ticket's age — so a table ordering two coffees after
 * an hour-long meal would appear as an hour-late ticket, and the one signal a
 * kitchen screen exists to give is destroyed by the most ordinary thing a
 * customer does.
 *
 * The later course inherits the *window* the order was promised, not its
 * deadline: whatever prep time the kitchen was given at the start, it gets
 * again from the moment the round is fired.
 */
function asTickets(order, items, now) {
  const byCourse = new Map();
  for (const item of items) {
    const course = item.course ?? 1;
    if (!byCourse.has(course)) byCourse.set(course, []);
    byCourse.get(course).push(item);
  }

  const placed = new Date(order.placedAt).getTime();
  const window = order.promisedAt ? new Date(order.promisedAt).getTime() - placed : null;

  return [...byCourse.entries()].map(([course, courseItems]) => {
    const firedAt = course === 1 ? placed : firedFor(courseItems, placed);
    const promisedAt = course === 1 ? order.promisedAt : window != null ? new Date(firedAt + window) : null;

    return {
      ...order,
      // Unique per ticket rather than per order, so the board can key on it and
      // a bump names the round it meant.
      ticketId: `${order.id}:${course}`,
      course,
      items: courseItems,
      firedAt,
      promisedAt,
      waitingMinutes: Math.floor((now - firedAt) / 60_000),
      isLate: promisedAt ? new Date(promisedAt).getTime() < now : false,
    };
  });
}

/** When a later round went up — the earliest of its lines, or the order itself. */
function firedFor(items, fallback) {
  const times = items.map((item) => (item.firedAt ? new Date(item.firedAt).getTime() : fallback));
  return times.length ? Math.min(...times) : fallback;
}

/**
 * What is cooked and waiting to be carried out, by table.
 *
 * The pass, not the stove. A waiter's question is the opposite of a cook's:
 * not "what do I make next" but "what is standing under the heat lamp and
 * whose table does it belong to". The board answers the first and was being
 * handed to waiters for want of anything else, which is why they were being
 * shown station filters and a "Start it" button for a fryer they do not work.
 *
 * Oldest first, because food that has been ready longest is the food going
 * cold.
 */
export async function readyToRun({ branchId, limit = 50 }) {
  const items = await prisma.orderItem.findMany({
    where: {
      status: "READY",
      parentItemId: null,
      order: {
        branchId,
        status: { in: ACTIVE_ORDER_STATUSES },
        setAsideAt: null,
      },
    },
    select: {
      id: true,
      nameSnapshot: true,
      quantity: true,
      notes: true,
      course: true,
      preparedAt: true,
      modifiers: { select: { nameSnapshot: true } },
      children: { select: { id: true, nameSnapshot: true, quantity: true } },
      order: {
        select: {
          id: true,
          orderNumber: true,
          type: true,
          placedAt: true,
          table: { select: { id: true, name: true, area: true } },
        },
      },
    },
    orderBy: [{ preparedAt: "asc" }],
    take: limit,
  });

  const now = Date.now();
  const runs = new Map();

  for (const item of items) {
    // Grouped by round, not by order: a starter standing on the pass and a
    // dessert that has just come up are two trips, and merging them would have
    // the waiter carry the cold one.
    const key = `${item.order.id}:${item.course ?? 1}`;
    if (!runs.has(key)) {
      runs.set(key, {
        ticketId: key,
        course: item.course ?? 1,
        order: item.order,
        items: [],
        readyAt: item.preparedAt,
      });
    }

    const run = runs.get(key);
    run.items.push(item);
    // The oldest plate on the tray is what the clock should show.
    if (item.preparedAt && (!run.readyAt || item.preparedAt < run.readyAt)) run.readyAt = item.preparedAt;
  }

  return [...runs.values()]
    .map((run) => ({
      ...run,
      waitingMinutes: run.readyAt ? Math.floor((now - new Date(run.readyAt).getTime()) / 60_000) : 0,
    }))
    .sort((a, b) => b.waitingMinutes - a.waitingMinutes);
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

/**
 * Bumps a ticket at once — the button a chef actually presses.
 *
 * `stationId` narrows it to that station's lines, and the board always sends
 * the station it is filtered to. It has to: a cook looking at the grill's
 * board sees the grill's lines, and a button on that screen can only honestly
 * mean the lines on that screen. Without the narrowing, the grill finishing a
 * burger marked the pizza ready too and sent the whole order out to be run.
 *
 * `course` narrows it the same way and for the same reason: the board draws
 * one ticket per round, so the button on a round can only mean that round's
 * lines. Without it a cook clearing a table's coffees would mark the main
 * course ready as well — food that has not been made.
 *
 * The order's own status still follows the items rather than the button —
 * `setItemStatus` moves it to READY only once nothing is outstanding — so a
 * station bumping its own lines leaves the order preparing until the last
 * station bumps theirs, which is what "ready" is supposed to mean.
 */
export async function bumpOrder({ orderId, status = "READY", stationId = null, course = null, actorId = null }) {
  const items = await prisma.orderItem.findMany({
    where: {
      orderId,
      parentItemId: null,
      // Only the lines that can actually reach the target. Handing a tray to a
      // table means the READY lines on it; starting or finishing a round means
      // the ones still outstanding. Asking for the outstanding set either way
      // meant the pass's "hand it over" button matched nothing at all.
      status: { in: status === "SERVED" ? ["READY"] : ACTIVE_ITEM_STATUSES },
      // The same set the station's board draws: its own lines, plus anything
      // unrouted, which shows on every board rather than on none. Matching the
      // screen exactly is the point — a button that covers a different set
      // from the one in front of you is how this went wrong in the first place.
      ...(stationId ? { OR: [{ stationId }, { stationId: null }] } : {}),
      ...(course ? { course } : {}),
    },
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

/**
 * Takes a stuck ticket off the kitchen's board.
 *
 * Deliberately not a status change and deliberately not automatic. A clock
 * cannot tell an abandoned order from a kitchen that is three hours behind,
 * and the hours when tickets get oldest are exactly the hours when hiding
 * work is most dangerous — so a person decides, and that person has to say
 * why. The order stays live, stays owed, and tells the customer nothing.
 *
 * What it is NOT allowed to do is disappear. Setting a ticket aside hands it
 * to whoever runs the till: the reason is on the order, the count is on their
 * overview, and either they send it back or they cancel the sale.
 */
export async function setAsideTicket({ orderId, reason, actorId = null }) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, branchId: true, status: true, orderNumber: true, setAsideAt: true },
  });
  if (!order) throw ApiError.notFound("Order not found");
  if (order.setAsideAt) return { orderId, alreadySetAside: true };

  if (!ACTIVE_ORDER_STATUSES.includes(order.status)) {
    throw ApiError.conflict(`A ${order.status.toLowerCase()} order is not on the board`, { status: order.status });
  }

  const updated = await prisma.order.update({
    where: { id: orderId },
    data: { setAsideAt: new Date(), setAsideById: actorId, setAsideReason: reason },
    select: { id: true, setAsideAt: true, setAsideReason: true },
  });

  await recordAudit({
    actorId,
    branchId: order.branchId,
    action: "kds.set_aside",
    entityType: "Order",
    entityId: orderId,
    changes: { reason },
  });

  return { orderId, setAsideAt: updated.setAsideAt, reason: updated.setAsideReason };
}

/** Puts it back on the board. The counterpart every kitchen display has. */
export async function recallTicket({ orderId, actorId = null }) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, branchId: true, setAsideAt: true },
  });
  if (!order) throw ApiError.notFound("Order not found");
  if (!order.setAsideAt) return { orderId, recalled: false };

  await prisma.order.update({
    where: { id: orderId },
    data: { setAsideAt: null, setAsideById: null, setAsideReason: null },
  });

  await recordAudit({
    actorId,
    branchId: order.branchId,
    action: "kds.recall",
    entityType: "Order",
    entityId: orderId,
  });

  return { orderId, recalled: true };
}

/** Tickets waiting on somebody at the till, newest first. */
export async function setAsideTickets({ branchId, limit = 50 }) {
  return prisma.order.findMany({
    where: { branchId, setAsideAt: { not: null }, status: { in: ACTIVE_ORDER_STATUSES } },
    select: {
      id: true,
      orderNumber: true,
      type: true,
      status: true,
      placedAt: true,
      grandTotal: true,
      currency: true,
      setAsideAt: true,
      setAsideById: true,
      setAsideReason: true,
      table: { select: { name: true } },
    },
    orderBy: { setAsideAt: "desc" },
    take: limit,
  });
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
