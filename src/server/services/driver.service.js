import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { ACTIVE_STATUSES } from "@/server/delivery/state";
import { money } from "@/server/pricing/engine";

/**
 * Drivers.
 *
 * A driver is a `User` with a `Driver` record, not a separate account type.
 * That is what lets the same person be a customer who also delivers, keeps one
 * login and one password-reset flow, and means driver endpoints authenticate
 * exactly like every other endpoint. The `Driver` row carries only what is true
 * of them *as a driver*: vehicle, availability, cash in hand.
 *
 * Availability is the part that needs care. `status` is what dispatch reads to
 * decide who can take a job, and it is changed from two directions — the driver
 * going on and off shift, and the system moving them to ON_DELIVERY as work is
 * assigned. Letting either clobber the other is how a driver ends up marked
 * available while holding three orders.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const SELECT = {
  id: true,
  userId: true,
  branchId: true,
  employeeId: true,
  status: true,
  vehicleType: true,
  vehicleNumber: true,
  licenseNumber: true,
  licenseExpiry: true,
  lastLatitude: true,
  lastLongitude: true,
  lastHeading: true,
  lastLocationAt: true,
  cashInHand: true,
  maxActiveOrders: true,
  ratingAverage: true,
  ratingCount: true,
  payoutPerDelivery: true,
  isActive: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true, phone: true, status: true } },
};

export async function listDrivers({ branchId, status, isActive, available, limit = 20, cursor } = {}) {
  const rows = await prisma.driver.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(status ? { status } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(available ? { status: "AVAILABLE", isActive: true } : {}),
    },
    select: {
      ...SELECT,
      _count: { select: { deliveries: { where: { status: { in: ACTIVE_STATUSES } } } } },
    },
    orderBy: { createdAt: "desc" },
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);
  return {
    ...page,
    items: page.items.map(({ _count, ...row }) => ({ ...row, activeDeliveries: _count.deliveries })),
  };
}

export async function getDriver(id) {
  const driver = await prisma.driver.findUnique({
    where: { id },
    select: {
      ...SELECT,
      _count: { select: { deliveries: { where: { status: { in: ACTIVE_STATUSES } } } } },
    },
  });
  if (!driver) throw ApiError.notFound("Driver not found");

  const { _count, ...rest } = driver;
  return { ...rest, activeDeliveries: _count.deliveries };
}

/** The driver record for a signed-in user, or null when they are not one. */
export async function driverForUser(userId) {
  return prisma.driver.findUnique({ where: { userId }, select: SELECT });
}

/** Throws rather than returning null — what every driver-facing route needs. */
export async function requireDriver(userId) {
  const driver = await driverForUser(userId);
  if (!driver) throw ApiError.forbidden("This account is not registered as a driver");
  if (!driver.isActive) throw ApiError.forbidden("This driver account is not active");
  return driver;
}

export async function createDriver(data, actor = null) {
  const user = await prisma.user.findFirst({
    where: { id: data.userId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!user) throw ApiError.validation("User not found", { userId: ["No such user"] });

  const existing = await prisma.driver.findUnique({ where: { userId: data.userId }, select: { id: true } });
  if (existing) throw ApiError.conflict("That user is already a driver", { driverId: existing.id });

  if (data.branchId) await assertBranchExists(data.branchId);

  return prisma.driver.create({
    data: {
      ...data,
      ...(data.payoutPerDelivery != null ? { payoutPerDelivery: money(data.payoutPerDelivery) } : {}),
      // Always created off-shift. A driver appearing as AVAILABLE the moment
      // they are onboarded would be handed a job before anyone told them the
      // account exists.
      status: "OFFLINE",
    },
    select: SELECT,
  });
}

async function assertBranchExists(branchId) {
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } });
  if (!branch) throw ApiError.validation("Branch not found", { branchId: ["No such branch"] });
}

export async function updateDriver(id, data) {
  await getDriver(id);
  if (data.branchId) await assertBranchExists(data.branchId);

  return prisma.driver.update({
    where: { id },
    data: {
      ...data,
      ...(data.payoutPerDelivery != null ? { payoutPerDelivery: money(data.payoutPerDelivery) } : {}),
    },
    select: SELECT,
  });
}

/**
 * Changes availability.
 *
 * Two rules protect the dispatch view from lying:
 *
 *   * A driver holding active work cannot go OFFLINE or ON_BREAK. Someone has
 *     their food; disappearing from the board is how it gets lost.
 *   * ON_DELIVERY is not settable by hand. It is a consequence of holding work,
 *     so it is maintained by the assignment code and refused here.
 */
export async function setDriverStatus({ driverId, status, actorIsDriver = false }) {
  const driver = await getDriver(driverId);

  if (status === "ON_DELIVERY") {
    throw ApiError.validation("This status is set by the system when work is assigned", {
      status: ["Choose AVAILABLE, ON_BREAK or OFFLINE"],
    });
  }

  // Suspension is a management action, not something a driver applies to
  // themselves or lifts from themselves.
  if (status === "SUSPENDED" && actorIsDriver) {
    throw ApiError.forbidden("A driver cannot change their own suspension");
  }
  if (driver.status === "SUSPENDED" && actorIsDriver) {
    throw ApiError.forbidden("This driver account is suspended");
  }

  if (["OFFLINE", "ON_BREAK"].includes(status) && driver.activeDeliveries > 0) {
    throw ApiError.conflict(
      `This driver still has ${driver.activeDeliveries} active deliver${driver.activeDeliveries === 1 ? "y" : "ies"}`,
      { activeDeliveries: driver.activeDeliveries },
    );
  }

  return prisma.driver.update({ where: { id: driverId }, data: { status }, select: SELECT });
}

/**
 * Records the driver's position.
 *
 * The last known point lives on `Driver` so a dispatch board has something to
 * draw before the first realtime frame arrives. Breadcrumbs are written to the
 * active delivery at a **sampled** rate — the schema is explicit that the live
 * stream belongs in a realtime channel, not in Postgres, and a row per ping
 * would be millions a day per city for data nobody reads except in a dispute.
 */
export async function recordLocation({ driverId, latitude, longitude, heading = null, accuracy = null, speedKph = null, at = new Date() }) {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { id: true, lastLocationAt: true },
  });
  if (!driver) throw ApiError.notFound("Driver not found");

  const active = await prisma.delivery.findFirst({
    where: { driverId, status: { in: ["PICKED_UP", "ON_THE_WAY", "ARRIVED"] } },
    select: { id: true, trackPoints: { select: { recordedAt: true }, orderBy: { recordedAt: "desc" }, take: 1 } },
    orderBy: { pickedUpAt: "asc" },
  });

  await withTransaction(async (tx) => {
    await tx.driver.update({
      where: { id: driverId },
      data: {
        lastLatitude: latitude,
        lastLongitude: longitude,
        lastHeading: heading,
        lastLocationAt: at,
      },
    });

    if (active) {
      const last = active.trackPoints[0]?.recordedAt;
      const elapsed = last ? at.getTime() - new Date(last).getTime() : Infinity;

      if (elapsed >= BREADCRUMB_INTERVAL_MS) {
        await tx.deliveryTrackPoint.create({
          data: { deliveryId: active.id, latitude, longitude, accuracy, speedKph, recordedAt: at },
        });
      }
    }
  });

  return { driverId, deliveryId: active?.id ?? null, recordedAt: at };
}

/** Roughly every 30 seconds, as the schema comment prescribes. */
export const BREADCRUMB_INTERVAL_MS = 30_000;

/** Breadcrumbs are evidence for disputes, not history to keep forever. */
export const TRACK_POINT_RETENTION_DAYS = 30;

export async function pruneTrackPoints(retentionDays = TRACK_POINT_RETENTION_DAYS, now = new Date()) {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
  const result = await prisma.deliveryTrackPoint.deleteMany({ where: { recordedAt: { lt: cutoff } } });
  return result.count;
}

/** Where a branch's drivers are right now — the dispatch map. */
export async function driverPositions({ branchId }) {
  const drivers = await prisma.driver.findMany({
    where: {
      branchId,
      isActive: true,
      status: { in: ["AVAILABLE", "ON_DELIVERY"] },
      lastLocationAt: { not: null },
    },
    select: {
      id: true,
      status: true,
      vehicleType: true,
      lastLatitude: true,
      lastLongitude: true,
      lastHeading: true,
      lastLocationAt: true,
      user: { select: { name: true } },
      _count: { select: { deliveries: { where: { status: { in: ACTIVE_STATUSES } } } } },
    },
  });

  return drivers.map(({ _count, ...driver }) => ({ ...driver, activeDeliveries: _count.deliveries }));
}

// --- shifts -----------------------------------------------------------------

/**
 * Starting a shift also brings the driver online.
 *
 * Two actions that are always taken together, so doing them separately just
 * creates a window where a driver is on shift but invisible to dispatch.
 */
export async function startShift({ driverId, branchId = null }) {
  const driver = await getDriver(driverId);

  const open = await prisma.driverShift.findFirst({
    where: { driverId, endedAt: null },
    select: { id: true, startedAt: true },
  });
  if (open) throw ApiError.conflict("This driver already has an open shift", { shiftId: open.id });

  return withTransaction(async (tx) => {
    const shift = await tx.driverShift.create({
      data: {
        driverId,
        branchId: branchId ?? driver.branchId,
        startCashInHand: driver.cashInHand,
      },
      select: { id: true, driverId: true, branchId: true, startedAt: true, startCashInHand: true },
    });

    await tx.driver.update({ where: { id: driverId }, data: { status: "AVAILABLE" } });
    return shift;
  });
}

/**
 * Ends a shift and reconciles the cash the driver is carrying.
 *
 * `cashHandedOver` is what they actually handed in. Any difference against
 * `cashInHand` stays on the driver's balance rather than being written off, so
 * it turns up as a deduction on their next payout instead of quietly vanishing.
 */
export async function endShift({ driverId, cashHandedOver = 0 }) {
  const driver = await getDriver(driverId);

  const shift = await prisma.driverShift.findFirst({
    where: { driverId, endedAt: null },
    select: { id: true, startedAt: true },
  });
  if (!shift) throw ApiError.conflict("This driver has no open shift");

  if (driver.activeDeliveries > 0) {
    throw ApiError.conflict("Finish or hand back the active deliveries before ending the shift", {
      activeDeliveries: driver.activeDeliveries,
    });
  }

  const handedOver = money(cashHandedOver);
  if (D(handedOver).greaterThan(D(driver.cashInHand))) {
    throw ApiError.validation("That is more than this driver is holding", {
      cashHandedOver: [`They are carrying ${driver.cashInHand}`],
    });
  }

  const delivered = await prisma.delivery.count({
    where: { driverId, deliveredAt: { gte: shift.startedAt } },
  });

  return withTransaction(async (tx) => {
    const closed = await tx.driverShift.update({
      where: { id: shift.id },
      data: { endedAt: new Date(), endCashHandedOver: handedOver, deliveriesCount: delivered },
      select: {
        id: true,
        driverId: true,
        startedAt: true,
        endedAt: true,
        startCashInHand: true,
        endCashHandedOver: true,
        deliveriesCount: true,
      },
    });

    await tx.driver.update({
      where: { id: driverId },
      data: {
        // Whatever was not handed in stays owed.
        cashInHand: money(D(driver.cashInHand).minus(D(handedOver))),
        status: "OFFLINE",
      },
    });

    return closed;
  });
}
