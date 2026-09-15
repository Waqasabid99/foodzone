import { Prisma } from "@/generated/prisma";
import { totalCost as tc, unitCost as uc } from "@/server/inventory/uom";

/**
 * Recipe and production-run costing.
 *
 * Pure, because these are the numbers a restaurant is actually run on and every
 * one of them is easy to get subtly backwards. Two conventions hold throughout,
 * and they are stated here once so no caller has to guess:
 *
 *   * **A variance is `actual − standard`.** A positive cost variance means the
 *     run cost more than the recipe said, which is *unfavourable*. `favourable`
 *     is returned as an explicit flag rather than left to the reader, because
 *     "is a positive yield variance good?" has the opposite answer to "is a
 *     positive cost variance good?" and mixing them up inverts a report.
 *   * **Cost is per one unit of the recipe's yield unit**, never per batch. A
 *     recipe that yields 20 portions for 400 costs 20 a portion; storing 400
 *     against a variant would make every plate look twenty times dearer.
 *
 * Labour and overhead are included in the roll-up. A recipe cost that counts
 * only ingredients understates the true cost of everything made in a prep
 * kitchen, and it is precisely the dishes with the most preparation — the ones
 * worth repricing — that it understates the most.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);
const ZERO = D(0);

/**
 * Rolls a recipe's ingredient costs up into a cost per output unit.
 *
 * `yieldQuantity` is what one run of the recipe produces. Guarded at zero: a
 * recipe that claims to yield nothing would otherwise divide by zero and poison
 * every dish that uses it as a sub-recipe.
 */
export function rollUpCost({ ingredientCosts = [], laborCost = 0, overheadCost = 0, yieldQuantity = 1 }) {
  const material = ingredientCosts.reduce((sum, cost) => sum.plus(D(cost)), ZERO);
  const labor = D(laborCost);
  const overhead = D(overheadCost);
  const total = material.plus(labor).plus(overhead);

  const yielded = D(yieldQuantity);
  const perUnit = yielded.greaterThan(0) ? total.dividedBy(yielded) : total;

  return {
    materialCost: tc(material),
    laborCost: tc(labor),
    overheadCost: tc(overhead),
    totalCost: tc(total),
    unitCost: uc(perUnit),
  };
}

/**
 * Splits a run's cost across what it produced.
 *
 * By-products — trimmings, stock made from bones, offcuts — are credited at
 * their own standard cost and the primary output absorbs whatever is left. This
 * is the conventional by-product credit method, and it is the right shape for a
 * kitchen: nobody runs a stock pot in order to make bones, so the bones must
 * not be allowed to carry away part of the cost of the roast.
 *
 * The primary share is floored at zero. A run whose by-products are notionally
 * worth more than the whole run cost is a data problem, not a reason to book a
 * negative cost into stock.
 */
export function allocateOutputCosts({ totalCost, outputs = [] }) {
  const total = D(totalCost);

  const byProducts = outputs.filter((output) => !output.isPrimary);
  const primaries = outputs.filter((output) => output.isPrimary);

  const credited = byProducts.map((output) => {
    const cost = tc(D(output.quantity).times(D(output.standardUnitCost ?? 0)));
    return { ...output, totalCost: cost, unitCost: uc(output.standardUnitCost ?? 0) };
  });

  const creditTotal = credited.reduce((sum, output) => sum.plus(D(output.totalCost)), ZERO);
  const remaining = Prisma.Decimal.max(total.minus(creditTotal), ZERO);

  // More than one primary output is unusual but legal (a dough split into two
  // shapes); they share the remainder by quantity.
  const primaryQuantity = primaries.reduce((sum, output) => sum.plus(D(output.quantity)), ZERO);

  const allocated = primaries.map((output) => {
    const share = primaryQuantity.greaterThan(0)
      ? remaining.times(D(output.quantity)).dividedBy(primaryQuantity)
      : ZERO;
    const quantity = D(output.quantity);

    return {
      ...output,
      totalCost: tc(share),
      unitCost: uc(quantity.greaterThan(0) ? share.dividedBy(quantity) : ZERO),
    };
  });

  return [...allocated, ...credited];
}

/**
 * Actual against standard.
 *
 * `favourable` is inverted by `higherIsBetter`: spending less than standard is
 * good, producing less than standard is not.
 */
export function variance({ standard, actual, higherIsBetter = false }) {
  const expected = D(standard);
  const got = D(actual);
  const amount = got.minus(expected);

  const percent = expected.isZero()
    ? ZERO
    : amount.dividedBy(expected.abs()).times(100);

  return {
    standard: tc(expected),
    actual: tc(got),
    variance: tc(amount),
    variancePercent: Number(percent.toDecimalPlaces(2)),
    favourable: amount.isZero() ? true : higherIsBetter ? amount.greaterThan(0) : amount.lessThan(0),
  };
}

/**
 * How much of what was started came out the other end.
 *
 * Returns the achieved yield as a percentage of what was planned, which is the
 * number a head chef recognises — "we got 92% of that batch" — alongside the
 * raw shortfall.
 */
export function yieldVariance({ planned, produced, wasted = 0 }) {
  const plannedQuantity = D(planned);
  const producedQuantity = D(produced);
  const wastedQuantity = D(wasted);

  const achieved = plannedQuantity.greaterThan(0)
    ? producedQuantity.dividedBy(plannedQuantity).times(100)
    : ZERO;

  return {
    plannedQuantity,
    producedQuantity,
    wastedQuantity,
    shortfall: producedQuantity.greaterThanOrEqualTo(plannedQuantity)
      ? ZERO
      : plannedQuantity.minus(producedQuantity),
    yieldPercent: Number(achieved.toDecimalPlaces(2)),
    favourable: producedQuantity.greaterThanOrEqualTo(plannedQuantity),
  };
}

/**
 * Splits a material variance into the two things that cause it.
 *
 * The decomposition matters because the two have different owners: a **price**
 * variance is the buyer's — the same amount of beef cost more than expected —
 * while a **usage** variance is the kitchen's — the beef cost what it should
 * but more of it went in. A single combined number tells nobody what to fix.
 *
 * Price is valued at actual quantity and usage at standard cost, which is the
 * standard convention and puts the joint rounding term in the price variance.
 */
export function materialVariance({ standardQuantity, actualQuantity, standardUnitCost, actualUnitCost }) {
  const stdQty = D(standardQuantity);
  const actQty = D(actualQuantity);
  const stdCost = D(standardUnitCost);
  const actCost = D(actualUnitCost ?? standardUnitCost);

  const priceVariance = actCost.minus(stdCost).times(actQty);
  const usageVariance = actQty.minus(stdQty).times(stdCost);

  return {
    standardCost: tc(stdQty.times(stdCost)),
    actualCost: tc(actQty.times(actCost)),
    priceVariance: tc(priceVariance),
    usageVariance: tc(usageVariance),
    totalVariance: tc(priceVariance.plus(usageVariance)),
    favourable: priceVariance.plus(usageVariance).lessThanOrEqualTo(0),
  };
}

/**
 * Food cost as a percentage of the selling price — the single number menu
 * engineering runs on.
 *
 * Returns null rather than zero when there is no price. A dish with no price
 * has an *unknown* food cost percentage, and reporting that as 0% would put it
 * at the top of the "most profitable" list.
 */
export function foodCostPercent({ cost, price }) {
  const sellingPrice = D(price ?? 0);
  if (sellingPrice.lessThanOrEqualTo(0)) return null;

  return Number(D(cost).dividedBy(sellingPrice).times(100).toDecimalPlaces(2));
}

/** Contribution per unit sold: price less the cost of making it. */
export function contributionMargin({ cost, price }) {
  if (price == null) return null;
  return tc(D(price).minus(D(cost)));
}
