import { Prisma } from "@/generated/prisma";
import { ApiError } from "@/lib/api";

/**
 * Unit conversion.
 *
 * Pure, because getting this wrong is the quietest and most expensive class of
 * inventory bug there is. A recipe calling for 200 **g** of an item stocked in
 * **kg** must deduct 0.2, not 200 — the second silently empties a store room
 * and makes every cost per plate a thousand times too high, and nothing about
 * the number looks wrong on a screen.
 *
 * Every unit converts through the base unit of its own type: `factor` is how
 * many base units are in one of this unit (kg → g is 1000). Two units can only
 * be converted between when they share a `type`; a recipe asking for 2 litres
 * of something sold by weight is a mistake, not a conversion.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

/** How many base units one of this unit is worth. */
export function factorOf(uom) {
  if (!uom) return D(1);
  // A unit with no base is itself the base of its type.
  return uom.baseUnitId ? D(uom.factor) : D(1);
}

/** The base unit a unit converts through: its own id when it is a base. */
export function rootOf(uom) {
  return uom.baseUnitId ?? uom.id;
}

/**
 * Converts a quantity between two units of the same type.
 *
 * Throws rather than guessing when the types differ. An inventory system that
 * silently treats "2 L" as "2 kg" is worse than one that refuses the line.
 */
export function convertQuantity({ quantity, from, to }) {
  if (!from || !to) return D(quantity);
  if (from.id === to.id) return D(quantity);

  if (from.type !== to.type) {
    throw ApiError.validation(`Cannot convert ${from.code} to ${to.code}`, {
      uomId: [`${from.code} measures ${from.type.toLowerCase()}, ${to.code} measures ${to.type.toLowerCase()}`],
    });
  }

  // Same type is not enough: two separate bases of one type — "pc" and a
  // "box" nobody linked to it — have no factor between them, and treating
  // them as 1:1 would book a box of 24 as one piece.
  if (rootOf(from) !== rootOf(to)) {
    throw ApiError.validation(`Cannot convert ${from.code} to ${to.code}`, {
      uomId: [`${from.code} and ${to.code} are not linked by a conversion`],
    });
  }

  // Through the shared base: quantity x from-factor gives base units, then
  // divided by the to-factor gives the target unit.
  const inBase = D(quantity).times(factorOf(from));
  return inBase.dividedBy(factorOf(to));
}

/**
 * Converts a **unit cost**, which moves the opposite way to a quantity.
 *
 * Buying at 500 per kg and stocking in grams is 0.5 per gram, not 500,000. The
 * inversion is the whole reason this is a separate function rather than a
 * second call to `convertQuantity` — reusing that one here is a mistake that
 * reads as correct.
 */
export function convertUnitCost({ unitCost, from, to }) {
  if (!from || !to || from.id === to.id) return D(unitCost);

  const quantityInTarget = convertQuantity({ quantity: 1, from, to });
  if (quantityInTarget.isZero()) return D(unitCost);

  return D(unitCost).dividedBy(quantityInTarget);
}

/** Rounds to the unit's own precision — what a store room can actually count. */
export function roundToUom(quantity, uom) {
  const precision = Number.isInteger(uom?.precision) ? uom.precision : 3;
  return D(quantity).toDecimalPlaces(precision, Prisma.Decimal.ROUND_HALF_UP);
}

/** Stock quantities are Decimal(18,6); round there and nowhere else. */
export function quantity(value) {
  return D(value).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
}

/** Costs are Decimal(18,6) per unit, Decimal(18,4) in total. */
export function unitCost(value) {
  return D(value).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
}

export function totalCost(value) {
  return D(value).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * The usable quantity after prep loss.
 *
 * An item with a 80% yield means 1kg bought becomes 800g on the plate, so a
 * recipe needing 800g has to draw 1kg from the store. Applied when exploding a
 * recipe, never when receiving stock — what arrives is what arrives.
 */
export function grossUpForYield({ net, yieldPercent }) {
  const percent = D(yieldPercent ?? 100);
  if (percent.lessThanOrEqualTo(0) || percent.greaterThanOrEqualTo(100)) return D(net);
  return D(net).times(100).dividedBy(percent);
}
