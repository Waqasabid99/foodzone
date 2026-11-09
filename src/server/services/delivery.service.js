import { prisma } from "@/lib/prisma";
import { deliveryChanged } from "@/server/realtime/notify";
import { ApiError } from "@/lib/api";
import { logger } from "@/lib/logger";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { getSettings } from "@/server/services/setting.service";
import { changeOrderStatus } from "@/server/services/order.service";
import { money } from "@/server/pricing/engine";
import { derivePaymentState } from "@/server/payments/state";
import { enqueue } from "@/server/jobs/outbox";
import {
  ACTIVE_STATUSES,
  IN_POSSESSION,
  ORDER_STATUS_FOR_DELIVERY,
  canTransitionDelivery,
  driverMayTransition,
} from "@/server/delivery/state";
import { branchFilter } from "@/server/access/scope";

/**
 * Deliveries and dispatch.
 *
 * The delivery row is created when the order is ready to leave, not when it is
 * placed: a delivery is a *job*, and a job that exists before there is anything
 * to carry clutters every dispatch board with work nobody can do.
 *
 * Two things here are worth stating plainly because they are where money and
 * food get lost:
 *
 *   * **COD is the driver's debt until it is handed over.** Collecting cash
 *     moves the payment to captured *and* increases `Driver.cashInHand`. That
 *     balance is settled at shift end and deducted from the payout if it is
 *     not — so a driver cannot simply keep it.
 *   * **The order and the delivery are two machines describing one journey.**
 *     Pickup and delivery are mirrored onto the order so a customer is never
 *     watching "preparing" while the driver is at their door.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const SELECT = {
  id: true,
  orderId: true,
  driverId: true,
  status: true,
  sequence: true,
  distanceKm: true,
  estimatedMinutes: true,
  deliveryFee: true,
  driverEarning: true,
  tipAmount: true,
  codAmount: true,
  codCollectedAt: true,
  recipientName: true,
  assignedById: true,
  assignedAt: true,
  acceptedAt: true,
  pickedUpAt: true,
  deliveredAt: true,
  failedAt: true,
  failureReason: true,
  createdAt: true,
};

const WITH_ORDER = {
  ...SELECT,
  order: {
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentState: true,
      grandTotal: true,
      branchId: true,
      addressSnapshot: true,
      customerNote: true,
      guestName: true,
      guestPhone: true,
      user: { select: { id: true, name: true, phone: true } },
    },
  },
  driver: {
    select: { id: true, status: true, vehicleType: true, user: { select: { name: true, phone: true } } },
  },
};

/** The outstanding COD on an order — what the driver is expected to collect. */
async function codFor(orderId, tx = prisma) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      grandTotal: true,
      paymentState: true,
      payments: { select: { status: true, amount: true, method: true } },
    },
  });
  if (!order) return D(0);

  if (["PAID", "REFUNDED"].includes(order.paymentState)) return D(0);

  const captured = order.payments
    .filter((payment) => ["CAPTURED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(payment.status))
    .reduce((total, payment) => total.plus(D(payment.amount)), D(0));

  return Prisma.Decimal.max(D(order.grandTotal).minus(captured), 0);
}

/**
 * Creates the delivery job for an order.
 *
 * Idempotent — `Delivery.orderId` is unique, and dispatch screens retry.
 */
export async function createDelivery({ orderId, actor = null }) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, type: true, status: true, branchId: true, deliveryFee: true, tipAmount: true },
  });
  if (!order) throw ApiError.notFound("Order not found");

  if (order.type !== "DELIVERY") {
    throw ApiError.conflict("Only delivery orders have a delivery job", { type: order.type });
  }
  if (["CANCELLED", "REJECTED", "REFUNDED"].includes(order.status)) {
    throw ApiError.conflict(`A ${order.status.toLowerCase()} order cannot be dispatched`);
  }

  const existing = await prisma.delivery.findUnique({ where: { orderId }, select: WITH_ORDER });
  if (existing) return existing;

  const settings = await getSettings({ branchId: order.branchId });
  const cod = await codFor(orderId);

  return prisma.delivery.create({
    data: {
      orderId,
      status: "PENDING",
      deliveryFee: order.deliveryFee,
      tipAmount: order.tipAmount,
      codAmount: cod,
      driverEarning: money(settings["delivery.driver_base_earning"] ?? 0),
      assignedById: actor?.userId ?? null,
    },
    select: WITH_ORDER,
  });
}

async function loadDelivery(id, select = WITH_ORDER) {
  const delivery = await prisma.delivery.findUnique({ where: { id }, select });
  if (!delivery) throw ApiError.notFound("Delivery not found");
  return delivery;
}

/**
 * Assigns a driver.
 *
 * Refuses when the driver is not in a state to take work, or is already at
 * their concurrent limit. `maxActiveOrders` is per driver rather than a global
 * setting because it is genuinely personal — a cyclist with an insulated bag
 * carries fewer orders than a van.
 */
export async function assignDriver({ deliveryId, driverId, actor = null, reassign = false }) {
  const delivery = await loadDelivery(deliveryId);

  if (!reassign && delivery.driverId && delivery.driverId !== driverId) {
    throw ApiError.conflict("This delivery already has a driver. Reassign it instead.", {
      driverId: delivery.driverId,
    });
  }

  // Reassigning away from a driver who is already carrying the food would leave
  // the order with one person and the job with another.
  if (reassign && IN_POSSESSION.includes(delivery.status)) {
    throw ApiError.conflict("The driver already has this order. Mark it failed before reassigning.", {
      status: delivery.status,
    });
  }

  if (!canTransitionDelivery(delivery.status, "ASSIGNED")) {
    throw ApiError.conflict(`A ${delivery.status.toLowerCase()} delivery cannot be assigned`, {
      allowed: delivery.status,
    });
  }

  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: {
      id: true,
      status: true,
      isActive: true,
      maxActiveOrders: true,
      branchId: true,
      _count: { select: { deliveries: { where: { status: { in: ACTIVE_STATUSES } } } } },
    },
  });
  if (!driver) throw ApiError.validation("Driver not found", { driverId: ["No such driver"] });

  if (!driver.isActive || ["OFFLINE", "SUSPENDED"].includes(driver.status)) {
    throw ApiError.conflict("That driver is not available for work", { status: driver.status });
  }
  if (driver._count.deliveries >= driver.maxActiveOrders) {
    throw ApiError.conflict(`That driver is already carrying ${driver._count.deliveries} orders`, {
      maxActiveOrders: driver.maxActiveOrders,
    });
  }

  const previousDriverId = delivery.driverId;

  const updated = await withTransaction(async (tx) => {
    const row = await tx.delivery.update({
      where: { id: deliveryId },
      data: {
        driverId,
        status: "ASSIGNED",
        assignedById: actor?.userId ?? null,
        assignedAt: new Date(),
        // A reassignment starts a fresh offer.
        acceptedAt: null,
      },
      select: WITH_ORDER,
    });

    await tx.driver.update({ where: { id: driverId }, data: { status: "ON_DELIVERY" } });

    // The previous driver goes back to available if this was their last job.
    if (previousDriverId && previousDriverId !== driverId) {
      await releaseDriverIfIdle(tx, previousDriverId);
    }

    return row;
  });

  await enqueue({ eventType: "delivery.assigned", payload: { deliveryId, driverId, orderId: delivery.orderId } });

  // The dispatch board loses a job from the unassigned column, and the
  // customer's tracking page gains a driver's name.
  deliveryChanged({
    orderId: delivery.orderId,
    branchId: updated.order?.branchId ?? null,
    userId: updated.order?.user?.id ?? null,
    type: "delivery.assigned",
  });

  return updated;
}

/** Sends a job back to the pool — the other half of reassignment. */
export async function unassignDelivery({ deliveryId, reason = null }) {
  const delivery = await loadDelivery(deliveryId, SELECT);

  if (IN_POSSESSION.includes(delivery.status)) {
    throw ApiError.conflict("The driver already has this order. Mark it failed instead.", {
      status: delivery.status,
    });
  }
  if (!canTransitionDelivery(delivery.status, "PENDING")) {
    throw ApiError.conflict(`A ${delivery.status.toLowerCase()} delivery cannot go back to the pool`);
  }

  return withTransaction(async (tx) => {
    const row = await tx.delivery.update({
      where: { id: deliveryId },
      data: { driverId: null, status: "PENDING", assignedAt: null, acceptedAt: null, failureReason: reason },
      select: WITH_ORDER,
    });

    if (delivery.driverId) await releaseDriverIfIdle(tx, delivery.driverId);
    return row;
  });
}

/**
 * Returns a driver to AVAILABLE once they hold no more work.
 *
 * Never touches a driver who has gone OFFLINE, ON_BREAK or SUSPENDED in the
 * meantime — finishing a delivery must not drag someone back on shift.
 */
async function releaseDriverIfIdle(tx, driverId) {
  const remaining = await tx.delivery.count({ where: { driverId, status: { in: ACTIVE_STATUSES } } });
  if (remaining > 0) return;

  const driver = await tx.driver.findUnique({ where: { id: driverId }, select: { status: true } });
  if (driver?.status === "ON_DELIVERY") {
    await tx.driver.update({ where: { id: driverId }, data: { status: "AVAILABLE" } });
  }
}

/**
 * Moves a delivery along.
 *
 * One entry point for both dispatch and the driver app, with `byDriver`
 * deciding which transitions are on offer — a driver can move their own job
 * forward and report a failure, but cannot cancel an order or hand a job back
 * once the food is in their bag.
 */
export async function setDeliveryStatus({
  deliveryId,
  status,
  actor = null,
  byDriver = false,
  recipientName = null,
  reason = null,
  collectedCod = null,
}) {
  const delivery = await loadDelivery(deliveryId);

  // Idempotent: a driver on a bad connection taps twice.
  if (delivery.status === status) return { delivery, changed: false };

  const permitted = byDriver
    ? driverMayTransition(delivery.status, status)
    : canTransitionDelivery(delivery.status, status);

  if (!permitted) {
    throw ApiError.conflict(`A delivery cannot go from ${delivery.status} to ${status}`, {
      allowed: byDriver ? "driver" : "dispatch",
      from: delivery.status,
    });
  }

  // Nothing is gated on branch settings here any more: a drop is done when the
  // rider says it is. A failure still needs a reason, because a job that ended
  // with the food undelivered is the one case somebody has to answer for.
  const now = new Date();

  if (status === "FAILED" && !reason?.trim()) {
    throw ApiError.validation("A failed delivery needs a reason", { reason: ["Required"] });
  }

  const stamps = {
    ACCEPTED: { acceptedAt: now },
    PICKED_UP: { pickedUpAt: now },
    DELIVERED: { deliveredAt: now },
    FAILED: { failedAt: now, failureReason: reason?.trim() ?? null },
    REJECTED: { failureReason: reason?.trim() ?? null },
  }[status] ?? {};

  const updated = await withTransaction(async (tx) => {
    const row = await tx.delivery.update({
      where: { id: deliveryId },
      data: {
        status,
        ...stamps,
        ...(recipientName ? { recipientName } : {}),
      },
      select: WITH_ORDER,
    });

    if (status === "DELIVERED" && D(delivery.codAmount).greaterThan(0)) {
      await settleCod({ tx, delivery, collectedCod, actor, now });
    }

    if (["DELIVERED", "FAILED", "REJECTED", "CANCELLED"].includes(status) && delivery.driverId) {
      await releaseDriverIfIdle(tx, delivery.driverId);
    }

    return row;
  });

  // The order transition runs outside the delivery transaction: it has its own
  // guards and its own status history, and a delivery that is recorded but
  // whose order lags is recoverable, whereas a lost delivery update is not.
  const orderStatus = ORDER_STATUS_FOR_DELIVERY[status];
  if (orderStatus) {
    await changeOrderStatus({
      orderId: delivery.orderId,
      toStatus: orderStatus,
      actorId: actor?.userId ?? null,
      note: `Delivery ${status.toLowerCase().replace(/_/g, " ")}`,
    }).catch((error) => {
      // The order may legitimately already be there, or past it — the delivery
      // is the record of what the driver did either way. Logged rather than
      // swallowed silently, because an order stuck behind its own delivery is
      // exactly the kind of drift nobody notices until a customer calls.
      logger.warn("order status did not follow delivery", {
        orderId: delivery.orderId,
        deliveryStatus: status,
        wanted: orderStatus,
        reason: error.message,
      });
    });
  }

  await enqueue({
    eventType: "delivery.status_changed",
    payload: { deliveryId, orderId: delivery.orderId, status },
  });

  deliveryChanged({
    orderId: delivery.orderId,
    branchId: updated.order?.branchId ?? null,
    userId: updated.order?.user?.id ?? null,
    type: "delivery.status",
  });

  return { delivery: updated, changed: true };
}

/**
 * Records the cash a driver took at the door.
 *
 * The COD payment is captured and the amount is added to the driver's balance
 * in one transaction. Both halves matter: the order is settled, *and* somebody
 * is on the hook for the notes in their pocket.
 *
 * The capture is announced with the same `payment.captured` event the till
 * raises, because that event is the only thing that posts a receipt. Writing
 * the row without it leaves the sale in accounts receivable for money already
 * collected, and nothing complains: the order reads as paid either way.
 */
async function settleCod({ tx, delivery, collectedCod, actor, now }) {
  const expected = D(delivery.codAmount);
  const collected = collectedCod == null ? expected : money(collectedCod);

  if (D(collected).greaterThan(expected)) {
    throw ApiError.validation("That is more than the order owes", {
      collectedCod: [`The outstanding amount is ${expected}`],
    });
  }

  let payment = await tx.payment.findFirst({
    where: { orderId: delivery.orderId, method: "CASH_ON_DELIVERY", status: { in: ["PENDING", "AUTHORIZED"] } },
    select: { id: true, amount: true },
  });

  if (!payment) {
    payment = await tx.payment.create({
      data: {
        orderId: delivery.orderId,
        branchId: delivery.order.branchId,
        method: "CASH_ON_DELIVERY",
        provider: "cash",
        status: "PENDING",
        amount: collected,
        currency: "PKR",
      },
      select: { id: true, amount: true },
    });
  }

  await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: "CAPTURED",
      amount: collected,
      capturedAt: now,
      collectedById: actor?.userId ?? null,
    },
  });

  await tx.delivery.update({
    where: { id: delivery.id },
    data: { codCollectedAt: now, codAmount: collected },
  });

  if (delivery.driverId) {
    await tx.driver.update({
      where: { id: delivery.driverId },
      data: { cashInHand: { increment: collected } },
    });
  }

  // Derived, not assigned — the same rule the payments module runs on.
  const order = await tx.order.findUnique({
    where: { id: delivery.orderId },
    select: {
      grandTotal: true,
      payments: { select: { status: true, amount: true } },
      refunds: { select: { status: true, amount: true } },
    },
  });

  await tx.order.update({
    where: { id: delivery.orderId },
    data: {
      paymentState: derivePaymentState({
        grandTotal: order.grandTotal,
        payments: order.payments,
        refunds: order.refunds,
      }),
    },
  });

  // In the transaction, so the capture and the thing that posts it either both
  // happen or neither does.
  await enqueue({
    eventType: "payment.captured",
    payload: { paymentId: payment.id, orderId: delivery.orderId },
    db: tx,
  });
}

// --- reads ------------------------------------------------------------------

export async function listDeliveries({ branchId, driverId, status, unassigned, scope = null, limit = 20, cursor } = {}) {
  // A delivery carries the customer's home address. Without the scope an
  // unfiltered request hands every one of them to anyone holding
  // `deliveries.read` anywhere. The branch comes from the order, not the
  // delivery — see src/server/delivery/access.js.
  const filter = branchFilter(scope);

  const rows = await prisma.delivery.findMany({
    where: {
      ...(filter ? { AND: [{ order: { branchId: filter } }] } : {}),
      ...(branchId ? { order: { branchId } } : {}),
      ...(driverId ? { driverId } : {}),
      ...(status ? { status } : {}),
      ...(unassigned ? { driverId: null, status: "PENDING" } : {}),
    },
    select: WITH_ORDER,
    orderBy: { createdAt: "asc" },
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

export async function getDelivery(id) {
  return loadDelivery(id);
}

/**
 * A driver's own queue.
 *
 * Ordered by `sequence` first so a batched multi-drop run is worked in the
 * order it was planned, not the order the jobs happened to be created.
 */
export async function driverQueue({ driverId }) {
  const deliveries = await prisma.delivery.findMany({
    where: { driverId, status: { in: ACTIVE_STATUSES } },
    select: WITH_ORDER,
    orderBy: [{ sequence: "asc" }, { assignedAt: "asc" }],
  });

  return deliveries.map((delivery) => ({
    ...delivery,
    // The driver needs the address and a phone number, not the customer's
    // account or what they paid.
    order: {
      id: delivery.order.id,
      orderNumber: delivery.order.orderNumber,
      status: delivery.order.status,
      addressSnapshot: delivery.order.addressSnapshot,
      customerNote: delivery.order.customerNote,
      contactName:
        delivery.order.addressSnapshot?.recipientName ??
        delivery.order.user?.name ??
        delivery.order.guestName,
      // The address's own number comes first: it is the person waiting at that
      // door, who may not be the account holder — someone ordering food to a
      // parent's house, or an account registered with an email and no phone at
      // all. A driver with no number is a driver who cannot deliver.
      contactPhone:
        delivery.order.addressSnapshot?.phone ??
        delivery.order.user?.phone ??
        delivery.order.guestPhone ??
        null,
    },
  }));
}

/**
 * Public delivery tracking for one order.
 *
 * Narrow on purpose: a tracking link is shared in messages and is not
 * authenticated by anything but the order it names, so it carries the driver's
 * first name and position and nothing else about them.
 */
export async function trackDelivery({ orderId }) {
  const delivery = await prisma.delivery.findUnique({
    where: { orderId },
    select: {
      status: true,
      estimatedMinutes: true,
      assignedAt: true,
      pickedUpAt: true,
      deliveredAt: true,
      driver: {
        select: {
          vehicleType: true,
          lastLatitude: true,
          lastLongitude: true,
          lastHeading: true,
          lastLocationAt: true,
          ratingAverage: true,
          user: { select: { name: true } },
        },
      },
    },
  });
  if (!delivery) return null;

  const driver = delivery.driver;
  const showPosition = IN_POSSESSION.includes(delivery.status);

  return {
    status: delivery.status,
    estimatedMinutes: delivery.estimatedMinutes,
    assignedAt: delivery.assignedAt,
    pickedUpAt: delivery.pickedUpAt,
    deliveredAt: delivery.deliveredAt,
    driver: driver
      ? {
          // First name only: the customer needs to recognise them at the door,
          // not to be able to look them up afterwards.
          name: String(driver.user?.name ?? "").split(" ")[0] || null,
          vehicleType: driver.vehicleType,
          rating: driver.ratingAverage,
          // The driver's position is shown only while they are actually
          // carrying this order — not before, and not once they have moved on.
          latitude: showPosition ? driver.lastLatitude : null,
          longitude: showPosition ? driver.lastLongitude : null,
          heading: showPosition ? driver.lastHeading : null,
          locationAt: showPosition ? driver.lastLocationAt : null,
        }
      : null,
  };
}

/** The breadcrumb trail, for disputes and distance checks. */
export async function deliveryTrack({ deliveryId }) {
  await loadDelivery(deliveryId, SELECT);

  return prisma.deliveryTrackPoint.findMany({
    where: { deliveryId },
    select: { latitude: true, longitude: true, accuracy: true, speedKph: true, recordedAt: true },
    orderBy: { recordedAt: "asc" },
  });
}
