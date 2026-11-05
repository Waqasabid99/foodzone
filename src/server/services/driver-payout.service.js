import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { money } from "@/server/pricing/engine";
import { enqueue } from "@/server/jobs/outbox";
import { branchFilter } from "@/server/access/scope";

/**
 * Driver payouts.
 *
 * A payout is a **snapshot**, not a live query. Once generated, its lines say
 * what was counted and the totals never move again — because the alternative is
 * a driver who was shown one figure on Monday and paid another on Friday, with
 * nothing to point at explaining why.
 *
 * The awkward part is COD. A driver carries the customer's cash between the
 * door and the till, and `Driver.cashInHand` is what they still owe. The payout
 * deducts it, which is the one place the two flows meet: earnings owed *to* the
 * driver, less cash owed *by* them. Getting the sign wrong here pays someone
 * twice.
 *
 *   DRAFT -> APPROVED -> PAID
 *        \-> CANCELLED
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const SELECT = {
  id: true,
  driverId: true,
  periodStart: true,
  periodEnd: true,
  deliveriesCount: true,
  earningsAmount: true,
  tipsAmount: true,
  adjustmentAmount: true,
  codDeduction: true,
  netAmount: true,
  status: true,
  approvedById: true,
  paidAt: true,
  paymentReference: true,
  createdAt: true,
};

const WITH_LINES = {
  ...SELECT,
  lines: { select: { id: true, deliveryId: true, label: true, amount: true } },
  driver: { select: { id: true, cashInHand: true, user: { select: { name: true, email: true } } } },
};

/**
 * Builds a payout for one driver over one period.
 *
 * Only **delivered** jobs count. A failed or cancelled delivery earns nothing,
 * and paying for one would make cancelling attractive.
 *
 * Deliveries already attached to another payout are excluded by construction —
 * `DriverPayoutLine.deliveryId` is how a drop is marked as counted, so the same
 * work cannot be paid for twice even if the periods overlap by mistake.
 */
export async function generatePayout({ driverId, periodStart, periodEnd, adjustmentAmount = 0, actor = null }) {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { id: true, cashInHand: true, payoutPerDelivery: true },
  });
  if (!driver) throw ApiError.notFound("Driver not found");

  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  if (end <= start) {
    throw ApiError.validation("The period end must be after its start", { periodEnd: ["Must be after the start"] });
  }

  const existing = await prisma.driverPayout.findFirst({
    where: { driverId, periodStart: start, periodEnd: end },
    select: { id: true, status: true },
  });
  if (existing) {
    throw ApiError.conflict("A payout already exists for this driver and period", {
      payoutId: existing.id,
      status: existing.status,
    });
  }

  const deliveries = await prisma.delivery.findMany({
    where: {
      driverId,
      status: "DELIVERED",
      deliveredAt: { gte: start, lte: end },
      // Never counted twice, whatever the periods say.
      payoutLines: { none: {} },
    },
    select: { id: true, driverEarning: true, tipAmount: true, deliveredAt: true, order: { select: { orderNumber: true } } },
    orderBy: { deliveredAt: "asc" },
  });

  let earnings = D(0);
  let tips = D(0);
  const lines = [];

  for (const delivery of deliveries) {
    // What was stamped on the job wins: the rate in force when the drop was
    // made, not whatever the driver's record says today. Re-reading the current
    // rate would silently reprice work that was already done. The driver's own
    // `payoutPerDelivery` is the fallback for a job that carried no rate at all
    // — which, once `delivery.driver_base_earning` is set for a branch, is only
    // the jobs created before it was.
    const earning = D(delivery.driverEarning).greaterThan(0)
      ? D(delivery.driverEarning)
      : D(driver.payoutPerDelivery ?? 0);

    earnings = earnings.plus(earning);
    tips = tips.plus(D(delivery.tipAmount));

    lines.push({
      deliveryId: delivery.id,
      label: `Order ${delivery.order.orderNumber}`,
      amount: money(earning.plus(D(delivery.tipAmount))),
    });
  }

  // Cash the driver is still holding comes off what they are owed.
  const codDeduction = D(driver.cashInHand);
  const adjustment = money(adjustmentAmount);
  const net = money(earnings.plus(tips).plus(D(adjustment)).minus(codDeduction));

  const payout = await withTransaction(async (tx) => {
    const row = await tx.driverPayout.create({
      data: {
        driverId,
        periodStart: start,
        periodEnd: end,
        deliveriesCount: deliveries.length,
        earningsAmount: money(earnings),
        tipsAmount: money(tips),
        adjustmentAmount: adjustment,
        codDeduction: money(codDeduction),
        netAmount: net,
        status: "DRAFT",
      },
      select: SELECT,
    });

    if (lines.length) {
      await tx.driverPayoutLine.createMany({
        data: lines.map((line) => ({ ...line, payoutId: row.id })),
      });
    }

    if (D(adjustment).abs().greaterThan(0)) {
      await tx.driverPayoutLine.createMany({
        data: [{ payoutId: row.id, deliveryId: null, label: "Adjustment", amount: adjustment }],
      });
    }

    return row;
  });

  return payout;
}

/**
 * Generates draft payouts for every driver with countable work in a period.
 *
 * Drivers with nothing to pay are skipped rather than given an empty payout —
 * a zero row is noise on an approval queue.
 */
export async function generatePayoutsForPeriod({ branchId = null, periodStart, periodEnd, actor = null }) {
  const drivers = await prisma.driver.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      deliveries: {
        some: {
          status: "DELIVERED",
          deliveredAt: { gte: new Date(periodStart), lte: new Date(periodEnd) },
          payoutLines: { none: {} },
        },
      },
    },
    select: { id: true },
  });

  const created = [];
  const skipped = [];

  for (const driver of drivers) {
    try {
      created.push(await generatePayout({ driverId: driver.id, periodStart, periodEnd, actor }));
    } catch (error) {
      // One driver already having a payout for the period must not stop the
      // other forty from being generated.
      skipped.push({ driverId: driver.id, reason: error.message });
    }
  }

  return { created: created.length, skipped, payouts: created };
}

export async function approvePayout({ payoutId, actor }) {
  const payout = await prisma.driverPayout.findUnique({ where: { id: payoutId }, select: SELECT });
  if (!payout) throw ApiError.notFound("Payout not found");

  if (payout.status !== "DRAFT") {
    throw ApiError.conflict(`A ${payout.status.toLowerCase()} payout cannot be approved`, { status: payout.status });
  }

  const approved = await withTransaction(async (tx) => {
    const row = await tx.driverPayout.update({
      where: { id: payoutId },
      data: { status: "APPROVED", approvedById: actor.userId },
      select: SELECT,
    });

    // Approving is when the restaurant agrees it owes the money, so it is when
    // the expense and the payable reach the ledger.
    await enqueue({ eventType: "finance.driver_payout_approved", payload: { payoutId }, db: tx });

    return row;
  });

  await recordAudit({
    actorId: actor.userId,
    action: "driver_payout.approve",
    entityType: "DriverPayout",
    entityId: payoutId,
    changes: { netAmount: Number(payout.netAmount), driverId: payout.driverId },
  });

  return approved;
}

/**
 * Marks a payout paid, and clears the COD it deducted.
 *
 * The two go together: the deduction is only real once the money has actually
 * been settled, and clearing `cashInHand` earlier would let a driver take
 * another float against a debt that had not been paid off.
 */
export async function markPayoutPaid({ payoutId, paymentReference = null, actor }) {
  const payout = await prisma.driverPayout.findUnique({ where: { id: payoutId }, select: SELECT });
  if (!payout) throw ApiError.notFound("Payout not found");

  if (payout.status === "PAID") return payout;
  if (payout.status !== "APPROVED") {
    throw ApiError.conflict("Approve the payout before marking it paid", { status: payout.status });
  }

  const paid = await withTransaction(async (tx) => {
    const row = await tx.driverPayout.update({
      where: { id: payoutId },
      data: { status: "PAID", paidAt: new Date(), paymentReference },
      select: SELECT,
    });

    if (D(payout.codDeduction).greaterThan(0)) {
      const driver = await tx.driver.findUnique({ where: { id: payout.driverId }, select: { cashInHand: true } });

      // Decremented rather than zeroed: the driver may have taken more COD
      // since the payout was generated, and that money is still owed.
      await tx.driver.update({
        where: { id: payout.driverId },
        data: {
          cashInHand: money(Prisma.Decimal.max(D(driver.cashInHand).minus(D(payout.codDeduction)), 0)),
        },
      });
    }

    return row;
  });

  await recordAudit({
    actorId: actor.userId,
    action: "driver_payout.paid",
    entityType: "DriverPayout",
    entityId: payoutId,
    changes: {
      netAmount: Number(payout.netAmount),
      codCleared: Number(payout.codDeduction),
      paymentReference,
    },
  });

  return paid;
}

export async function cancelPayout({ payoutId, actor }) {
  const payout = await prisma.driverPayout.findUnique({ where: { id: payoutId }, select: SELECT });
  if (!payout) throw ApiError.notFound("Payout not found");

  if (payout.status === "PAID") {
    throw ApiError.conflict("A paid payout cannot be cancelled. Raise an adjustment on the next one.");
  }

  const cancelled = await withTransaction(async (tx) => {
    // The lines are removed so the deliveries they covered become countable
    // again; otherwise cancelling a payout would strand that work unpaid
    // forever.
    await tx.driverPayoutLine.deleteMany({ where: { payoutId } });
    return tx.driverPayout.update({ where: { id: payoutId }, data: { status: "CANCELLED" }, select: SELECT });
  });

  await recordAudit({
    actorId: actor.userId,
    action: "driver_payout.cancel",
    entityType: "DriverPayout",
    entityId: payoutId,
    changes: { netAmount: Number(payout.netAmount) },
  });

  return cancelled;
}

export async function listPayouts({ driverId, status, branchId = null, scope = null, limit = 20, cursor } = {}) {
  // A payout is somebody's pay, and it reaches a branch only through its
  // driver — so that is the path the scope has to take.
  const filter = branchFilter(scope);

  const rows = await prisma.driverPayout.findMany({
    where: {
      ...(filter ? { AND: [{ driver: { branchId: filter } }] } : {}),
      ...(branchId ? { driver: { branchId } } : {}),
      ...(driverId ? { driverId } : {}),
      ...(status ? { status } : {}),
    },
    select: { ...SELECT, driver: { select: { id: true, user: { select: { name: true } } } } },
    orderBy: { createdAt: "desc" },
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

export async function getPayout(id) {
  const payout = await prisma.driverPayout.findUnique({ where: { id }, select: WITH_LINES });
  if (!payout) throw ApiError.notFound("Payout not found");
  return payout;
}

/** What a driver has earned but not yet been paid — the figure they ask about. */
export async function driverEarningsSummary({ driverId }) {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { id: true, cashInHand: true, payoutPerDelivery: true },
  });
  if (!driver) throw ApiError.notFound("Driver not found");

  const uncounted = await prisma.delivery.findMany({
    where: { driverId, status: "DELIVERED", payoutLines: { none: {} } },
    select: { driverEarning: true, tipAmount: true },
  });

  const earnings = uncounted.reduce(
    (total, delivery) =>
      total.plus(D(delivery.driverEarning).greaterThan(0) ? D(delivery.driverEarning) : D(driver.payoutPerDelivery ?? 0)),
    D(0),
  );
  const tips = uncounted.reduce((total, delivery) => total.plus(D(delivery.tipAmount)), D(0));

  return {
    driverId,
    unpaidDeliveries: uncounted.length,
    earnings: money(earnings),
    tips: money(tips),
    cashInHand: driver.cashInHand,
    estimatedNet: money(earnings.plus(tips).minus(D(driver.cashInHand))),
  };
}
