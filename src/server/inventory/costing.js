import { Prisma } from "@/generated/prisma";
import { quantity, totalCost, unitCost } from "@/server/inventory/uom";

/**
 * Stock costing.
 *
 * Pure. Two methods, and the difference between them is money:
 *
 *   * **FIFO** — the oldest stock is consumed first, at the price it was bought
 *     for. Correct for perishables, and the only honest answer when prices move
 *     between deliveries.
 *   * **Weighted average** — one blended cost per item, recomputed on every
 *     receipt. Simpler, and what most kitchens actually run.
 *
 * The functions here decide *which batches* and *at what cost*; writing the
 * result is the ledger's job next door. Keeping the arithmetic here means the
 * awkward cases — consuming across three batches, a receipt at a new price, a
 * partial batch left over — are testable without a database.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

/**
 * Orders batches for consumption: soonest expiry first, then oldest receipt.
 *
 * Expiry before receipt date on purpose. Stock that will spoil next week has to
 * leave before stock received a day earlier that lasts a month, or the older
 * batch is used and the newer one is thrown away.
 */
export function orderBatchesForConsumption(batches) {
  return [...batches].sort((a, b) => {
    const aExpiry = a.expiryDate ? new Date(a.expiryDate).getTime() : Infinity;
    const bExpiry = b.expiryDate ? new Date(b.expiryDate).getTime() : Infinity;
    if (aExpiry !== bExpiry) return aExpiry - bExpiry;

    const aReceived = new Date(a.receivedAt ?? 0).getTime();
    const bReceived = new Date(b.receivedAt ?? 0).getTime();
    if (aReceived !== bReceived) return aReceived - bReceived;

    // A stable tie-break, so the same basket always consumes the same batches.
    return String(a.id).localeCompare(String(b.id));
  });
}

/**
 * Works out which batches cover a quantity, and what that costs.
 *
 * Returns `shortfall` rather than throwing when there is not enough. Whether a
 * kitchen may go negative is a policy decision that belongs to the caller: a
 * sale that has already happened must be recorded even if the stock says it was
 * impossible, whereas a transfer out of an empty shelf should be refused.
 */
export function allocateFifo({ batches, required }) {
  const ordered = orderBatchesForConsumption(
    batches.filter((batch) => batch.status === "ACTIVE" && D(batch.remainingQuantity).greaterThan(0)),
  );

  let remaining = D(required);
  const allocations = [];
  let cost = D(0);

  for (const batch of ordered) {
    if (remaining.lessThanOrEqualTo(0)) break;

    const available = D(batch.remainingQuantity);
    const take = Prisma.Decimal.min(available, remaining);
    if (take.lessThanOrEqualTo(0)) continue;

    allocations.push({
      batchId: batch.id,
      quantity: quantity(take),
      unitCost: unitCost(batch.unitCost),
      totalCost: totalCost(take.times(D(batch.unitCost))),
      // The batch is finished if this takes the last of it.
      depletes: available.minus(take).lessThanOrEqualTo(0),
    });

    cost = cost.plus(take.times(D(batch.unitCost)));
    remaining = remaining.minus(take);
  }

  return {
    allocations,
    shortfall: quantity(Prisma.Decimal.max(remaining, 0)),
    totalCost: totalCost(cost),
    // The blended rate actually paid for what was allocated.
    effectiveUnitCost: D(required).greaterThan(0)
      ? unitCost(cost.dividedBy(D(required).minus(remaining).greaterThan(0) ? D(required).minus(remaining) : 1))
      : unitCost(0),
  };
}

/**
 * The new weighted average after receiving stock.
 *
 * Guards the case that makes this formula bite: when on-hand is zero or
 * negative, there is nothing to blend with, so the incoming cost simply becomes
 * the cost. Blending against a negative balance produces a nonsensical — often
 * negative — average that then prices every plate wrong until someone notices.
 */
export function newWeightedAverage({ currentQuantity, currentCost, incomingQuantity, incomingCost }) {
  const onHand = D(currentQuantity);
  const incoming = D(incomingQuantity);

  if (incoming.lessThanOrEqualTo(0)) return unitCost(currentCost);
  if (onHand.lessThanOrEqualTo(0)) return unitCost(incomingCost);

  const totalValue = onHand.times(D(currentCost)).plus(incoming.times(D(incomingCost)));
  const totalQuantity = onHand.plus(incoming);

  return unitCost(totalValue.dividedBy(totalQuantity));
}

/**
 * Spreads a landed cost (freight, duty, handling) across receipt lines.
 *
 * Allocated **by line value**, not by quantity: a pallet of napkins and a box
 * of saffron do not attract the same share of a freight bill, and weighting by
 * value is the conventional and defensible answer. Any rounding remainder is
 * put on the largest line so the parts always add back to the whole.
 */
export function allocateLandedCost({ lines, landedCost }) {
  const extra = D(landedCost);
  if (extra.lessThanOrEqualTo(0) || !lines.length) {
    return lines.map((line) => ({ ...line, landedShare: totalCost(0) }));
  }

  const total = lines.reduce((sum, line) => sum.plus(D(line.lineTotal)), D(0));

  if (total.lessThanOrEqualTo(0)) {
    // Nothing to weight by — spread it evenly rather than dropping it.
    const share = extra.dividedBy(lines.length);
    return lines.map((line) => ({ ...line, landedShare: totalCost(share) }));
  }

  const allocated = lines.map((line) => ({
    ...line,
    landedShare: totalCost(extra.times(D(line.lineTotal)).dividedBy(total)),
  }));

  const distributed = allocated.reduce((sum, line) => sum.plus(D(line.landedShare)), D(0));
  const remainder = extra.minus(distributed);

  if (!remainder.isZero()) {
    let largest = 0;
    for (let index = 1; index < allocated.length; index += 1) {
      if (D(allocated[index].lineTotal).greaterThan(D(allocated[largest].lineTotal))) largest = index;
    }
    allocated[largest].landedShare = totalCost(D(allocated[largest].landedShare).plus(remainder));
  }

  return allocated;
}

/** The true per-unit cost of a receipt line once freight is landed on it. */
export function landedUnitCost({ quantity: qty, lineTotal, landedShare }) {
  const units = D(qty);
  if (units.lessThanOrEqualTo(0)) return unitCost(0);
  return unitCost(D(lineTotal).plus(D(landedShare)).dividedBy(units));
}
