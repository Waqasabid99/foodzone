import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { logger } from "@/lib/logger";
import { withTransaction } from "@/server/utils/db";
import { postMovement } from "@/server/inventory/ledger";
import { quantity as q } from "@/server/inventory/uom";
import { explodeOrder } from "@/server/inventory/order-explosion";
import { consumeForOrder, releaseForOrder } from "@/server/services/reservation.service";
import { defaultLocationFor } from "@/server/services/inventory-item.service";

/**
 * Sale-time depletion: turning a sold dish back into the ingredients it used.
 *
 * This is the join between the catalog and the store room, and it is what makes
 * theoretical-versus-actual usage possible — the single most valuable number in
 * restaurant inventory. Without it, stock only ever changes when somebody
 * remembers to type something in.
 *
 * A sold order line is exploded through its variant's recipe, recursively for
 * sub-recipes, plus any modifier that carries ingredients ("extra cheese" is
 * 30g of cheese). Each ingredient is converted into the item's stocking unit
 * and grossed up for prep yield: a recipe needing 800g of trimmed beef from an
 * item that yields 80% must draw 1kg from the shelf.
 *
 * Two decisions shape the whole module:
 *
 *   * **Depletion never blocks a sale.** It runs after the order is done, from
 *     the outbox, and posts with `allowNegative`. The food has physically left
 *     the kitchen; refusing to record that because the system thought the
 *     shelf was empty would make the system *more* wrong, not less.
 *   * **It is idempotent per order.** Movements are tagged with the order id,
 *     and an order already deducted is skipped. A redelivered event must not
 *     empty a store room twice.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

/**
 * Deducts an order's ingredients from stock.
 *
 * Called from the outbox when an order completes. Safe to call twice: an order
 * that already has SALE_OUT movements is skipped.
 */
export async function depleteForOrder({ orderId, locationId = null, actor = null }) {
  const already = await prisma.stockMovement.count({ where: { orderId, type: "SALE_OUT" } });
  if (already > 0) return { orderId, skipped: true, reason: "ALREADY_DEPLETED", lines: 0 };

  const { branchId, lines } = await explodeOrder({ orderId });
  if (!branchId || !lines.length) {
    // Most restaurants run without recipes for a while. That is a valid state,
    // not an error — there is simply nothing to deduct yet.
    //
    // The holds still have to end. An order whose recipe was deleted between
    // the placing and the cooking has nothing to deduct and a hold that is
    // now permanent, and under `enforce` that is stock quietly withdrawn from
    // sale for good.
    await releaseForOrder({ orderId, reason: "Order completed with nothing to deduct" });
    return { orderId, skipped: true, reason: "NO_RECIPES", lines: 0 };
  }

  const location = locationId
    ? { id: locationId }
    : await defaultLocationFor(branchId);

  if (!location) {
    logger.warn("no stock location for branch; skipping depletion", { orderId, branchId });
    await releaseForOrder({ orderId, reason: "Order completed with no stock location" });
    return { orderId, skipped: true, reason: "NO_LOCATION", lines: 0 };
  }

  const posted = await withTransaction(async (tx) => {
    const results = [];

    for (const line of lines) {
      const result = await postMovement(tx, {
        itemId: line.itemId,
        locationId: location.id,
        type: "SALE_OUT",
        quantity: line.quantity,
        orderId,
        referenceType: "ORDER",
        referenceId: orderId,
        notes: `Sold: ${line.name}`,
        performedById: actor?.userId ?? null,
        // The food has left the kitchen. Refusing to record that because the
        // shelf looked empty would make the ledger less true, not more.
        allowNegative: true,
      });

      if (result) results.push({ itemId: line.itemId, quantity: line.quantity });
    }

    /*
     * The hold this order was carrying becomes the deduction just posted.
     *
     * In the same transaction, because on-hand falling and the hold on it
     * being given back are one event. A crash between them leaves stock both
     * gone and spoken for, which shows up as negative availability and stays
     * that way until somebody rebuilds the cache.
     */
    await consumeForOrder({ orderId, tx });

    return results;
  });

  return { orderId, skipped: false, locationId: location.id, lines: posted.length, deducted: posted };
}

/**
 * Puts an order's ingredients back.
 *
 * For a cancellation after the food was already deducted. Posted as a customer
 * return rather than by deleting the original movements — the ledger is
 * append-only, and a sale that happened and was reversed is two facts, not
 * zero.
 */
export async function reverseDepletion({ orderId, actor = null }) {
  const movements = await prisma.stockMovement.findMany({
    where: { orderId, type: "SALE_OUT" },
    select: { itemId: true, locationId: true, quantity: true, unitCost: true },
  });
  if (!movements.length) return { orderId, reversed: 0 };

  const already = await prisma.stockMovement.count({ where: { orderId, type: "CUSTOMER_RETURN" } });
  if (already > 0) return { orderId, reversed: 0, skipped: true, reason: "ALREADY_REVERSED" };

  await withTransaction(async (tx) => {
    for (const movement of movements) {
      await postMovement(tx, {
        itemId: movement.itemId,
        locationId: movement.locationId,
        type: "CUSTOMER_RETURN",
        quantity: D(movement.quantity).abs(),
        unitCost: movement.unitCost,
        orderId,
        referenceType: "ORDER_REVERSAL",
        referenceId: orderId,
        notes: "Order cancelled after depletion",
        performedById: actor?.userId ?? null,
      });
    }
  });

  return { orderId, reversed: movements.length };
}

/**
 * Theoretical versus actual usage.
 *
 * What the recipes say should have been used against what the ledger says left
 * the shelf. A persistent gap is portioning drift, waste that is not being
 * recorded, or theft — and it is invisible without this comparison.
 */
export async function usageVariance({ branchId, from, to }) {
  const window = {
    ...(from ? { gte: new Date(from) } : {}),
    ...(to ? { lte: new Date(to) } : {}),
  };

  const [theoretical, actual] = await Promise.all([
    prisma.stockMovement.groupBy({
      by: ["itemId"],
      where: { branchId, type: "SALE_OUT", ...(from || to ? { occurredAt: window } : {}) },
      _sum: { quantity: true },
    }),
    prisma.stockMovement.groupBy({
      by: ["itemId"],
      where: {
        branchId,
        type: { in: ["COUNT_CORRECTION", "WASTAGE", "ADJUSTMENT_OUT"] },
        ...(from || to ? { occurredAt: window } : {}),
      },
      _sum: { quantity: true },
    }),
  ]);

  const byItem = new Map();
  for (const row of theoretical) {
    byItem.set(row.itemId, { itemId: row.itemId, sold: D(row._sum.quantity ?? 0).abs(), unexplained: D(0) });
  }
  for (const row of actual) {
    const entry = byItem.get(row.itemId) ?? { itemId: row.itemId, sold: D(0), unexplained: D(0) };
    entry.unexplained = D(row._sum.quantity ?? 0).abs();
    byItem.set(row.itemId, entry);
  }

  const items = await prisma.inventoryItem.findMany({
    where: { id: { in: [...byItem.keys()] } },
    select: { id: true, sku: true, name: true, averageCost: true, uom: { select: { code: true } } },
  });
  const itemById = new Map(items.map((item) => [item.id, item]));

  return [...byItem.values()]
    .map((entry) => {
      const item = itemById.get(entry.itemId);
      const ratio = entry.sold.greaterThan(0)
        ? entry.unexplained.dividedBy(entry.sold).times(100)
        : D(0);

      return {
        item: item ?? { id: entry.itemId },
        soldQuantity: q(entry.sold),
        unexplainedQuantity: q(entry.unexplained),
        unexplainedPercent: Number(ratio.toDecimalPlaces(2)),
        valueAtRisk: Number(entry.unexplained.times(D(item?.averageCost ?? 0)).toDecimalPlaces(4)),
      };
    })
    .sort((a, b) => b.valueAtRisk - a.valueAtRisk);
}
