import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { allocateFifo, newWeightedAverage } from "@/server/inventory/costing";
import { quantity as q, totalCost as tc, unitCost as uc } from "@/server/inventory/uom";

/**
 * The stock ledger.
 *
 * **Every** change to stock goes through `postMovement`. Not most of them —
 * every one. `StockMovement` is append-only and is the truth; `StockLevel` is a
 * cache that exists only because summing a million rows on every screen is too
 * slow. The moment some other code path updates a level directly, the cache and
 * the truth disagree, and the only way to find out is a stock count that comes
 * up short with nothing to explain it.
 *
 * That single path is what makes `rebuildLevels` possible: replay the ledger,
 * and every level is provably correct again. A system where that rebuild does
 * not reproduce the cached numbers has a bug it cannot even locate.
 *
 * Signs are fixed by movement type rather than trusted from callers — an
 * "adjustment out" sent as a positive number would otherwise increase stock.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

/** Movement types that take stock out. Everything else puts it in. */
const OUTBOUND = [
  "PRODUCTION_OUT",
  "SALE_OUT",
  "TRANSFER_OUT",
  "ADJUSTMENT_OUT",
  "WASTAGE",
  "RETURN_TO_SUPPLIER",
];

/** Types whose direction is decided by the caller's sign, not the type. */
const SIGNED = ["COUNT_CORRECTION", "OPENING_BALANCE"];

export function isOutbound(type) {
  return OUTBOUND.includes(type);
}

export function directionFor(type, rawQuantity) {
  const magnitude = D(rawQuantity).abs();
  if (SIGNED.includes(type)) return D(rawQuantity);
  return isOutbound(type) ? magnitude.negated() : magnitude;
}

/**
 * Writes one movement and everything that follows from it.
 *
 * Must be called inside a transaction — it touches the ledger, the level cache,
 * batch remainders and the item's average cost, and a partial application of
 * those is precisely the corruption the whole module exists to prevent.
 *
 * `allowNegative` is a deliberate parameter rather than a global rule. A sale
 * that already happened must be recorded even when the system thinks there was
 * nothing left; a transfer off an empty shelf should be refused. Both are
 * correct, in different places.
 *
 * `restoreBatch` puts quantity back onto a named batch on the way in. Only a
 * reversal of a movement that drew from that batch should ask for it.
 */
export async function postMovement(tx, {
  itemId,
  locationId,
  type,
  quantity,
  uomId = null,
  unitCost = null,
  batchId = null,
  orderId = null,
  referenceType = null,
  referenceId = null,
  notes = null,
  performedById = null,
  occurredAt = new Date(),
  allowNegative = false,
  restoreBatch = false,
}) {
  if (!tx) throw new Error("postMovement must run inside a transaction");

  const item = await tx.inventoryItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      sku: true,
      name: true,
      uomId: true,
      costingMethod: true,
      averageCost: true,
      trackBatches: true,
      isActive: true,
    },
  });
  if (!item) throw ApiError.validation("Inventory item not found", { itemId: ["No such item"] });

  const location = await tx.stockLocation.findUnique({
    where: { id: locationId },
    select: { id: true, branchId: true, isActive: true, name: true },
  });
  if (!location) throw ApiError.validation("Stock location not found", { locationId: ["No such location"] });

  const signed = directionFor(type, quantity);
  if (signed.isZero()) {
    // A zero movement is noise in the ledger, not an error — the caller simply
    // had nothing to post.
    return null;
  }

  const level = await tx.stockLevel.findUnique({
    where: { itemId_locationId: { itemId, locationId } },
    select: { id: true, quantity: true },
  });
  const onHand = D(level?.quantity ?? 0);
  const after = onHand.plus(signed);

  if (after.lessThan(0) && !allowNegative) {
    throw ApiError.conflict(`Not enough ${item.name} at ${location.name}`, {
      itemId,
      locationId,
      available: Number(onHand),
      requested: Number(signed.abs()),
    });
  }

  // --- costing ------------------------------------------------------------
  let effectiveUnitCost = unitCost == null ? D(item.averageCost) : D(unitCost);
  const batchAllocations = [];

  if (signed.lessThan(0)) {
    // Going out: FIFO draws from real batches at what they actually cost.
    if (item.trackBatches && !batchId) {
      const batches = await tx.stockBatch.findMany({
        where: { itemId, locationId, status: "ACTIVE", remainingQuantity: { gt: 0 } },
        select: { id: true, remainingQuantity: true, unitCost: true, expiryDate: true, receivedAt: true, status: true },
      });

      const allocation = allocateFifo({ batches, required: signed.abs() });

      if (allocation.shortfall.greaterThan(0) && !allowNegative) {
        throw ApiError.conflict(`Not enough ${item.name} in batches at ${location.name}`, {
          shortfall: Number(allocation.shortfall),
        });
      }

      batchAllocations.push(...allocation.allocations);
      if (allocation.allocations.length) effectiveUnitCost = allocation.effectiveUnitCost;
    } else if (batchId) {
      const batch = await tx.stockBatch.findUnique({
        where: { id: batchId },
        select: { id: true, remainingQuantity: true, unitCost: true },
      });
      if (!batch) throw ApiError.validation("Batch not found", { batchId: ["No such batch"] });

      const take = Prisma.Decimal.min(D(batch.remainingQuantity), signed.abs());
      batchAllocations.push({
        batchId,
        quantity: q(take),
        unitCost: uc(batch.unitCost),
        totalCost: tc(take.times(D(batch.unitCost))),
        depletes: D(batch.remainingQuantity).minus(take).lessThanOrEqualTo(0),
      });
      effectiveUnitCost = D(batch.unitCost);
    }
  } else {
    // Coming back in against a batch we took it out of — a cancelled
    // production run returning issued material, or a customer return of a
    // known lot. The remainder has to go back with it, or the batch rows and
    // the level cache disagree for good: `rebuildLevels` replays movements
    // into levels and would never notice.
    //
    // Opt-in rather than inferred from `batchId`, because a goods receipt also
    // posts inbound against a batch — one it created a moment earlier with the
    // remainder already on it. Restoring there would book the delivery twice.
    if (restoreBatch && batchId) {
      const batch = await tx.stockBatch.findUnique({
        where: { id: batchId },
        select: { id: true, status: true },
      });

      if (batch) {
        await tx.stockBatch.update({
          where: { id: batchId },
          data: {
            remainingQuantity: { increment: q(signed) },
            ...(batch.status === "DEPLETED" ? { status: "ACTIVE" } : {}),
          },
        });
      }
    }

    if (item.costingMethod === "WEIGHTED_AVERAGE" && unitCost != null) {
      // Coming in at a known price: reprice the item as a whole. Done across
      // all locations, because an item has one cost, not one per shelf.
      const totals = await tx.stockLevel.aggregate({ where: { itemId }, _sum: { quantity: true } });

      const blended = newWeightedAverage({
        currentQuantity: totals._sum.quantity ?? 0,
        currentCost: item.averageCost,
        incomingQuantity: signed,
        incomingCost: unitCost,
      });

      await tx.inventoryItem.update({
        where: { id: itemId },
        data: { averageCost: blended, lastPurchaseCost: uc(unitCost) },
      });
    } else if (unitCost != null) {
      await tx.inventoryItem.update({ where: { id: itemId }, data: { lastPurchaseCost: uc(unitCost) } });
    }
  }

  // --- batch remainders ---------------------------------------------------
  for (const allocation of batchAllocations) {
    await tx.stockBatch.update({
      where: { id: allocation.batchId },
      data: {
        remainingQuantity: { decrement: allocation.quantity },
        ...(allocation.depletes ? { status: "DEPLETED" } : {}),
      },
    });
  }

  // --- the level cache ----------------------------------------------------
  await tx.stockLevel.upsert({
    where: { itemId_locationId: { itemId, locationId } },
    create: { itemId, locationId, quantity: q(after) },
    update: { quantity: q(after) },
  });

  // --- the ledger ---------------------------------------------------------
  const movement = await tx.stockMovement.create({
    data: {
      itemId,
      branchId: location.branchId,
      locationId,
      batchId: batchAllocations.length === 1 ? batchAllocations[0].batchId : batchId,
      type,
      quantity: q(signed),
      uomId: uomId ?? item.uomId,
      unitCost: uc(effectiveUnitCost),
      totalCost: tc(signed.abs().times(D(effectiveUnitCost))),
      // Stored so a point-in-time valuation never has to replay the ledger.
      balanceAfter: q(after),
      orderId,
      referenceType,
      referenceId,
      notes,
      performedById,
      occurredAt,
    },
    select: { id: true, quantity: true, unitCost: true, totalCost: true, balanceAfter: true, type: true },
  });

  return { movement, batchAllocations, balanceAfter: q(after) };
}

/**
 * Posts many movements as one unit.
 *
 * A transfer, a production run and a posted count are each several movements
 * that are only meaningful together — half a transfer is stock that exists in
 * neither place.
 */
export async function postMovements(tx, movements) {
  const results = [];
  for (const movement of movements) {
    const result = await postMovement(tx, movement);
    if (result) results.push(result);
  }
  return results;
}

/**
 * Rebuilds the level cache by replaying the ledger.
 *
 * The safety net under the whole design, and the thing that makes "the ledger
 * is the truth" a testable claim rather than a slogan. Returns what it changed,
 * so a scheduled run that reports drift is a signal something wrote around
 * `postMovement`.
 */
export async function rebuildLevels({ itemId = null, locationId = null } = {}) {
  const grouped = await prisma.stockMovement.groupBy({
    by: ["itemId", "locationId"],
    where: { ...(itemId ? { itemId } : {}), ...(locationId ? { locationId } : {}) },
    _sum: { quantity: true },
  });

  const drift = [];

  for (const row of grouped) {
    const expected = q(row._sum.quantity ?? 0);

    const level = await prisma.stockLevel.findUnique({
      where: { itemId_locationId: { itemId: row.itemId, locationId: row.locationId } },
      select: { id: true, quantity: true },
    });

    if (!level || !D(level.quantity).equals(expected)) {
      drift.push({
        itemId: row.itemId,
        locationId: row.locationId,
        cached: level ? Number(level.quantity) : null,
        actual: Number(expected),
      });

      await prisma.stockLevel.upsert({
        where: { itemId_locationId: { itemId: row.itemId, locationId: row.locationId } },
        create: { itemId: row.itemId, locationId: row.locationId, quantity: expected },
        update: { quantity: expected },
      });
    }
  }

  return { checked: grouped.length, corrected: drift.length, drift };
}

/** On-hand for one item at one location, straight from the cache. */
export async function onHand({ itemId, locationId }, tx = prisma) {
  const level = await tx.stockLevel.findUnique({
    where: { itemId_locationId: { itemId, locationId } },
    select: { quantity: true, reservedQuantity: true },
  });

  return {
    quantity: q(level?.quantity ?? 0),
    reserved: q(level?.reservedQuantity ?? 0),
    available: q(D(level?.quantity ?? 0).minus(D(level?.reservedQuantity ?? 0))),
  };
}
