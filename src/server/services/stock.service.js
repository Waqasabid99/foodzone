import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { postMovement, rebuildLevels } from "@/server/inventory/ledger";
import { quantity as q, totalCost as tc } from "@/server/inventory/uom";

/**
 * Reading stock: what is on hand, what it is worth, what is about to expire.
 *
 * Writes live in the ledger; this module is the read side plus the two batch
 * operations that are not movements in themselves — quarantining a lot and
 * writing one off.
 *
 * Valuation is kept behind its own permission (`stock.view_valuation`) because
 * it exposes cost prices, which is commercially sensitive in a way that "how
 * many buns are left" is not.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

export async function stockOnHand({ branchId, locationId, itemId, categoryId, lowOnly = false, limit = 50, cursor } = {}) {
  const rows = await prisma.stockLevel.findMany({
    where: {
      ...(locationId ? { locationId } : {}),
      ...(branchId ? { location: { branchId } } : {}),
      ...(itemId ? { itemId } : {}),
      ...(categoryId ? { item: { categoryId } } : {}),
    },
    select: {
      id: true,
      quantity: true,
      reservedQuantity: true,
      updatedAt: true,
      item: {
        select: {
          id: true,
          sku: true,
          name: true,
          reorderLevel: true,
          reorderQuantity: true,
          averageCost: true,
          uom: { select: { code: true, precision: true } },
        },
      },
      location: { select: { id: true, name: true, code: true, branchId: true } },
    },
    orderBy: [{ item: { name: "asc" } }, { id: "asc" }],
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);

  const items = page.items.map((level) => ({
    itemId: level.item.id,
    sku: level.item.sku,
    name: level.item.name,
    uom: level.item.uom.code,
    location: level.location,
    quantity: level.quantity,
    reserved: level.reservedQuantity,
    available: q(D(level.quantity).minus(D(level.reservedQuantity))),
    reorderLevel: level.item.reorderLevel,
    isLow: level.item.reorderLevel != null && D(level.quantity).lessThanOrEqualTo(D(level.item.reorderLevel)),
    updatedAt: level.updatedAt,
  }));

  return { ...page, items: lowOnly ? items.filter((item) => item.isLow) : items };
}

/**
 * What the stock is worth.
 *
 * Valued at the item's average cost rather than by replaying batches: a
 * valuation is a management number read constantly, and walking every lot on
 * every request would make it unusable. Batch-level value is available per item
 * for the cases that need it.
 */
export async function stockValuation({ branchId, locationId, categoryId } = {}) {
  const levels = await prisma.stockLevel.findMany({
    where: {
      ...(locationId ? { locationId } : {}),
      ...(branchId ? { location: { branchId } } : {}),
      ...(categoryId ? { item: { categoryId } } : {}),
      quantity: { not: 0 },
    },
    select: {
      quantity: true,
      item: {
        select: {
          id: true,
          sku: true,
          name: true,
          averageCost: true,
          category: { select: { id: true, name: true } },
          uom: { select: { code: true } },
        },
      },
      location: { select: { id: true, name: true } },
    },
  });

  let total = D(0);
  const byCategory = new Map();
  const lines = [];

  for (const level of levels) {
    const value = D(level.quantity).times(D(level.item.averageCost));
    total = total.plus(value);

    const key = level.item.category?.id ?? "uncategorised";
    const bucket = byCategory.get(key) ?? {
      categoryId: level.item.category?.id ?? null,
      name: level.item.category?.name ?? "Uncategorised",
      value: D(0),
    };
    bucket.value = bucket.value.plus(value);
    byCategory.set(key, bucket);

    lines.push({
      itemId: level.item.id,
      sku: level.item.sku,
      name: level.item.name,
      uom: level.item.uom.code,
      location: level.location,
      quantity: level.quantity,
      unitCost: level.item.averageCost,
      value: tc(value),
    });
  }

  return {
    totalValue: tc(total),
    lineCount: lines.length,
    byCategory: [...byCategory.values()].map((bucket) => ({ ...bucket, value: tc(bucket.value) })),
    lines: lines.sort((a, b) => Number(b.value) - Number(a.value)),
  };
}

/** The ledger itself — every movement, newest first. */
export async function listMovements({ itemId, locationId, branchId, type, from, to, orderId, limit = 50, cursor } = {}) {
  const rows = await prisma.stockMovement.findMany({
    where: {
      ...(itemId ? { itemId } : {}),
      ...(locationId ? { locationId } : {}),
      ...(branchId ? { branchId } : {}),
      ...(type ? { type } : {}),
      ...(orderId ? { orderId } : {}),
      ...(from || to
        ? { occurredAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
    },
    select: {
      id: true,
      type: true,
      quantity: true,
      unitCost: true,
      totalCost: true,
      balanceAfter: true,
      referenceType: true,
      referenceId: true,
      orderId: true,
      notes: true,
      performedById: true,
      occurredAt: true,
      item: { select: { id: true, sku: true, name: true, uom: { select: { code: true } } } },
      location: { select: { id: true, name: true } },
      batch: { select: { id: true, batchNumber: true } },
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

/**
 * Items below their reorder level — the purchasing to-do list.
 *
 * Suggests a quantity that brings stock back to the reorder level plus the
 * configured reorder quantity, so ordering exactly the shortfall does not leave
 * the item low again the moment anything is used.
 */
export async function reorderReport({ branchId }) {
  const levels = await prisma.stockLevel.findMany({
    where: { location: { branchId }, item: { isActive: true, reorderLevel: { not: null } } },
    select: {
      quantity: true,
      item: {
        select: {
          id: true,
          sku: true,
          name: true,
          reorderLevel: true,
          reorderQuantity: true,
          averageCost: true,
          uom: { select: { code: true } },
          supplierItems: {
            where: { isPreferred: true },
            select: {
              unitPrice: true,
              leadTimeDays: true,
              supplier: { select: { id: true, name: true } },
            },
            take: 1,
          },
        },
      },
      location: { select: { id: true, name: true } },
    },
  });

  return levels
    .filter((level) => D(level.quantity).lessThanOrEqualTo(D(level.item.reorderLevel)))
    .map((level) => {
      const target = D(level.item.reorderLevel).plus(D(level.item.reorderQuantity ?? 0));
      const suggested = Prisma.Decimal.max(target.minus(D(level.quantity)), 0);

      return {
        itemId: level.item.id,
        sku: level.item.sku,
        name: level.item.name,
        uom: level.item.uom.code,
        location: level.location,
        onHand: level.quantity,
        reorderLevel: level.item.reorderLevel,
        suggestedQuantity: q(suggested),
        preferredSupplier: level.item.supplierItems[0]?.supplier ?? null,
        estimatedCost: tc(suggested.times(D(level.item.supplierItems[0]?.unitPrice ?? level.item.averageCost))),
      };
    });
}

// --- batches ----------------------------------------------------------------

const BATCH_SELECT = {
  id: true,
  itemId: true,
  locationId: true,
  batchNumber: true,
  supplierLotNumber: true,
  initialQuantity: true,
  remainingQuantity: true,
  unitCost: true,
  status: true,
  manufacturedAt: true,
  expiryDate: true,
  receivedAt: true,
  item: { select: { id: true, sku: true, name: true, uom: { select: { code: true } } } },
  location: { select: { id: true, name: true, branchId: true } },
};

export async function listBatches({ itemId, locationId, branchId, status, expiringWithinDays, limit = 50, cursor } = {}) {
  const expiryFilter =
    expiringWithinDays != null
      ? { expiryDate: { not: null, lte: new Date(Date.now() + Number(expiringWithinDays) * 86_400_000) } }
      : {};

  const rows = await prisma.stockBatch.findMany({
    where: {
      ...(itemId ? { itemId } : {}),
      ...(locationId ? { locationId } : {}),
      ...(branchId ? { location: { branchId } } : {}),
      ...(status ? { status } : {}),
      ...expiryFilter,
    },
    select: BATCH_SELECT,
    orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }],
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

/**
 * Stock that will expire soon, or already has.
 *
 * The number a kitchen acts on daily: use it, discount it, or throw it away
 * before it becomes a health issue rather than a cost one.
 */
export async function expiryReport({ branchId, withinDays = 7 }) {
  const horizon = new Date(Date.now() + Number(withinDays) * 86_400_000);
  const now = new Date();

  const batches = await prisma.stockBatch.findMany({
    where: {
      ...(branchId ? { location: { branchId } } : {}),
      status: { in: ["ACTIVE", "QUARANTINED"] },
      remainingQuantity: { gt: 0 },
      expiryDate: { not: null, lte: horizon },
    },
    select: BATCH_SELECT,
    orderBy: { expiryDate: "asc" },
  });

  return batches.map((batch) => {
    const expiry = new Date(batch.expiryDate);
    const days = Math.floor((expiry.getTime() - now.getTime()) / 86_400_000);

    return {
      ...batch,
      daysUntilExpiry: days,
      isExpired: expiry <= now,
      valueAtRisk: tc(D(batch.remainingQuantity).times(D(batch.unitCost))),
    };
  });
}

/**
 * Holds a batch back from use without removing it.
 *
 * Quarantine is not a write-off: a suspect delivery may turn out to be fine.
 * The stock stays on the books and in the valuation; it simply stops being
 * allocated by FIFO, because `allocateFifo` only considers ACTIVE batches.
 */
export async function setBatchStatus({ batchId, status, actor = null, notes = null }) {
  const batch = await prisma.stockBatch.findUnique({
    where: { id: batchId },
    select: { id: true, status: true, remainingQuantity: true, itemId: true, locationId: true },
  });
  if (!batch) throw ApiError.notFound("Batch not found");

  if (batch.status === "DEPLETED") {
    throw ApiError.conflict("This batch is finished; there is nothing to quarantine or release");
  }

  return prisma.stockBatch.update({
    where: { id: batchId },
    data: { status },
    select: BATCH_SELECT,
  });
}

/**
 * Writes a batch off entirely — expired, contaminated, or failed inspection.
 *
 * Posted as a `WASTAGE` movement rather than by editing the batch, so the loss
 * appears in the ledger, in the wastage report and in the cost of goods. Stock
 * that simply disappears from the numbers is stock nobody learns from.
 */
export async function writeOffBatch({ batchId, reason = "EXPIRED", notes = null, actor = null }) {
  const batch = await prisma.stockBatch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      itemId: true,
      locationId: true,
      batchNumber: true,
      remainingQuantity: true,
      unitCost: true,
      status: true,
    },
  });
  if (!batch) throw ApiError.notFound("Batch not found");

  if (D(batch.remainingQuantity).lessThanOrEqualTo(0)) {
    throw ApiError.conflict("This batch is already empty");
  }

  return withTransaction(async (tx) => {
    await postMovement(tx, {
      itemId: batch.itemId,
      locationId: batch.locationId,
      type: "WASTAGE",
      quantity: batch.remainingQuantity,
      batchId,
      unitCost: batch.unitCost,
      referenceType: "BATCH_WRITE_OFF",
      referenceId: batchId,
      notes: notes ?? `Batch ${batch.batchNumber} written off (${reason})`,
      performedById: actor?.userId ?? null,
    });

    await tx.wastage.create({
      data: {
        itemId: batch.itemId,
        locationId: batch.locationId,
        quantity: batch.remainingQuantity,
        unitCost: batch.unitCost,
        totalCost: tc(D(batch.remainingQuantity).times(D(batch.unitCost))),
        reason,
        notes,
        recordedById: actor?.userId ?? null,
        approvedById: actor?.userId ?? null,
      },
    });

    return tx.stockBatch.update({
      where: { id: batchId },
      data: { status: reason === "EXPIRED" ? "EXPIRED" : "DEPLETED" },
      select: BATCH_SELECT,
    });
  });
}

/**
 * Marks passed-expiry batches as EXPIRED so FIFO stops handing them out.
 *
 * Deliberately does **not** write them off. Expired stock still physically
 * exists and still has to be counted, photographed and disposed of by a person;
 * a job that silently removed it from the books would destroy the evidence of
 * how much is being wasted, which is the number a kitchen is managed on.
 */
export async function flagExpiredBatches(now = new Date()) {
  const result = await prisma.stockBatch.updateMany({
    where: { status: "ACTIVE", remainingQuantity: { gt: 0 }, expiryDate: { not: null, lt: now } },
    data: { status: "EXPIRED" },
  });

  return result.count;
}

export { rebuildLevels };
