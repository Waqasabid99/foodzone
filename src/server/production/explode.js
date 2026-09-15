import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { logger } from "@/lib/logger";
import { convertQuantity, grossUpForYield, quantity as q } from "@/server/inventory/uom";

/**
 * Recipe explosion — turning "one burger" into "180g beef, 2 buns, 30g cheese".
 *
 * This lives on its own because three very different things need exactly the
 * same arithmetic and must never disagree about it:
 *
 *   * sale-time depletion, which deducts what a sold dish used;
 *   * production planning, which reserves what a run will consume;
 *   * recipe costing, which prices what a dish costs to make.
 *
 * If costing computed 180g and depletion deducted 200g, every food-cost report
 * in the system would be quietly wrong and nothing would ever flag it. So the
 * per-ingredient arithmetic is `requiredQuantity` below, and all three callers
 * go through it.
 *
 * Three multipliers stack, in this order, and the order matters:
 *
 *   1. **recipe wastage** — loss specific to this dish (trimming a fillet for
 *      this recipe but not another), applied to the recipe quantity;
 *   2. **yield scaling** — a recipe that makes four portions and is being made
 *      once draws a quarter of it;
 *   3. **item yield** — a property of the item as stocked, so it is applied
 *      last, after the quantity is in the stocking unit. An item yielding 80%
 *      means a recipe needing 800g has to draw 1kg off the shelf.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

/** How deep sub-recipes may nest before we assume a cycle. */
export const MAX_RECIPE_DEPTH = 6;

const UOM_SELECT = { id: true, code: true, type: true, factor: true, baseUnitId: true, precision: true };

/** Everything an explosion needs from one recipe, in one query. */
export const RECIPE_EXPLOSION_SELECT = {
  id: true,
  name: true,
  version: true,
  yieldQuantity: true,
  yieldUomId: true,
  laborCost: true,
  overheadCost: true,
  ingredients: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      itemId: true,
      subRecipeId: true,
      quantity: true,
      wastagePercent: true,
      isOptional: true,
      uom: { select: UOM_SELECT },
      item: {
        select: {
          id: true,
          sku: true,
          name: true,
          yieldPercent: true,
          uomId: true,
          averageCost: true,
          costingMethod: true,
          uom: { select: UOM_SELECT },
        },
      },
      subRecipe: {
        select: {
          id: true,
          name: true,
          version: true,
          yieldQuantity: true,
          yieldUomId: true,
          computedUnitCost: true,
          yieldUom: { select: UOM_SELECT },
        },
      },
    },
  },
};

/**
 * How much of one ingredient a given number of recipe outputs needs, in the
 * **item's stocking unit**.
 *
 * The single piece of arithmetic that depletion, planning and costing share.
 * `multiplier` is how many output units are being made, in the recipe's own
 * yield unit.
 */
export function requiredQuantity({ ingredient, multiplier, yieldQuantity }) {
  const withWastage = D(ingredient.quantity).times(
    D(100).plus(D(ingredient.wastagePercent ?? 0)).dividedBy(100),
  );

  // A recipe that yields four portions and makes one draws a quarter of it.
  const perOutput = D(yieldQuantity).greaterThan(0)
    ? D(multiplier).dividedBy(D(yieldQuantity))
    : D(multiplier);

  const required = withWastage.times(perOutput);

  // A sub-recipe is measured in **its own** yield unit, and the line may name a
  // different one: "200 g of burger sauce" against a sauce recipe that yields
  // 2 kg. Without this conversion the multiplier handed to the recursion is
  // 200 rather than 0.2, and the sub-recipe is exploded a thousand times over.
  // There is no item yield to gross up for — that applies to the sub-recipe's
  // own ingredients, one level down.
  if (ingredient.subRecipe) {
    return convertQuantity({
      quantity: required,
      from: ingredient.uom,
      to: ingredient.subRecipe.yieldUom,
    });
  }

  if (!ingredient.item) return required;

  const inStockingUnit = convertQuantity({
    quantity: required,
    from: ingredient.uom,
    to: ingredient.item.uom,
  });

  return grossUpForYield({ net: inStockingUnit, yieldPercent: ingredient.item.yieldPercent });
}

/**
 * Flattens a recipe into inventory items and quantities.
 *
 * Recursive: a burger's recipe may call for "burger sauce", itself a recipe of
 * five things. `seen` guards against a recipe that eventually includes itself,
 * which would otherwise recurse until the process dies. A cycle is logged and
 * cut rather than thrown, because refusing to deduct stock for a sold dish is
 * worse than deducting a little too little.
 */
export async function explodeRecipe({ recipeId, multiplier, tx = prisma, depth = 0, seen = new Set() }) {
  if (depth > MAX_RECIPE_DEPTH || seen.has(recipeId)) {
    logger.warn("recipe nesting too deep or cyclic", { recipeId, depth });
    return [];
  }

  const recipe = await tx.recipe.findUnique({ where: { id: recipeId }, select: RECIPE_EXPLOSION_SELECT });
  if (!recipe) return [];

  const lines = [];
  const nextSeen = new Set(seen).add(recipeId);

  for (const ingredient of recipe.ingredients) {
    const required = requiredQuantity({ ingredient, multiplier, yieldQuantity: recipe.yieldQuantity });

    if (ingredient.subRecipeId) {
      lines.push(
        ...(await explodeRecipe({
          recipeId: ingredient.subRecipeId,
          multiplier: required,
          tx,
          depth: depth + 1,
          seen: nextSeen,
        })),
      );
      continue;
    }

    if (!ingredient.itemId || !ingredient.item) continue;

    lines.push({
      itemId: ingredient.itemId,
      quantity: required,
      name: ingredient.item.name,
      sku: ingredient.item.sku,
      uomId: ingredient.item.uomId,
    });
  }

  return lines;
}

/** Sums an exploded list so one item appears once, however many recipes used it. */
export function mergeLines(lines) {
  const totals = new Map();

  for (const line of lines) {
    const existing = totals.get(line.itemId);
    if (existing) existing.quantity = existing.quantity.plus(D(line.quantity));
    else totals.set(line.itemId, { ...line, quantity: D(line.quantity) });
  }

  return [...totals.values()].map((line) => ({ ...line, quantity: q(line.quantity) }));
}
