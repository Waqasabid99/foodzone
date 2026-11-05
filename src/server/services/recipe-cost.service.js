import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { logger } from "@/lib/logger";
import { convertUnitCost, quantity as q, totalCost as tc, unitCost as uc } from "@/server/inventory/uom";
import {
  MAX_RECIPE_DEPTH,
  RECIPE_EXPLOSION_SELECT,
  requiredQuantity,
} from "@/server/production/explode";
import {
  contributionMargin,
  foodCostPercent,
  rollUpCost,
} from "@/server/production/costing";

/**
 * Recipe costing — what a dish costs to make.
 *
 * The roll-up walks the recipe tree and prices every leaf at the item's current
 * cost, then adds the recipe's own labour and overhead. Three choices in here
 * are worth stating because each one is a place this commonly goes wrong:
 *
 *   * **Sub-recipes are costed recursively, not read from cache.** A sauce
 *     whose stored cost is three months old would silently under-cost every
 *     dish that uses it. The stored `computedUnitCost` is a *result*, written
 *     after a roll-up, never an input to one.
 *   * **A zero-cost ingredient is reported, not hidden.** An item that has
 *     never been received has an average cost of zero, and a recipe full of
 *     them costs nothing at all — which reads as a wonderfully profitable dish
 *     rather than as missing data. Every such line comes back in
 *     `missingCosts`, and the caller can see exactly how much of the dish is
 *     unpriced.
 *   * **Cost is per one unit of yield.** A recipe yielding 20 portions returns
 *     the cost of one portion, so it can be compared with a menu price without
 *     anybody dividing by hand.
 *
 * Nothing here writes stock. Costing is a read of the item master; the only
 * writes are the cached roll-up on the recipe and the standard cost on the
 * variant, both of which are caches of this calculation.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

/**
 * Costs one recipe, recursively.
 *
 * `memo` stops a shared sub-recipe from being walked once per parent — a base
 * stock used by six sauces is priced once. `seen` is the cycle guard, and cuts
 * rather than throwing so one bad recipe cannot take the whole costing job
 * down with it.
 */
export async function costRecipe({ recipeId, tx = prisma, depth = 0, seen = new Set(), memo = new Map() }) {
  if (memo.has(recipeId)) return memo.get(recipeId);

  if (depth > MAX_RECIPE_DEPTH || seen.has(recipeId)) {
    logger.warn("recipe nesting too deep or cyclic while costing", { recipeId, depth });
    return null;
  }

  const recipe = await tx.recipe.findUnique({
    where: { id: recipeId },
    select: { ...RECIPE_EXPLOSION_SELECT, variantId: true, outputItemId: true, isActive: true },
  });
  if (!recipe) return null;

  const nextSeen = new Set(seen).add(recipeId);
  const lines = [];
  const missingCosts = [];

  for (const ingredient of recipe.ingredients) {
    // Multiplier equals the yield, so this prices one whole run of the recipe.
    const required = requiredQuantity({
      ingredient,
      multiplier: recipe.yieldQuantity,
      yieldQuantity: recipe.yieldQuantity,
    });

    if (ingredient.subRecipe) {
      const sub = await costRecipe({
        recipeId: ingredient.subRecipeId,
        tx,
        depth: depth + 1,
        seen: nextSeen,
        memo,
      });

      const subUnitCost = D(sub?.unitCost ?? 0);
      const lineCost = subUnitCost.times(required);

      if (!sub) {
        missingCosts.push({ subRecipeId: ingredient.subRecipeId, reason: "UNRESOLVED_SUB_RECIPE" });
      } else if (subUnitCost.isZero()) {
        missingCosts.push({ subRecipeId: ingredient.subRecipeId, name: sub.name, reason: "SUB_RECIPE_COSTS_NOTHING" });
      } else {
        // A sub-recipe with an unpriced ingredient carries that gap upwards. A
        // sauce that is 90% priced still makes the pizza that uses it only
        // partly priced, and a parent reporting itself fully costed on top of
        // an incomplete child is exactly the false confidence this field
        // exists to prevent.
        missingCosts.push(
          ...sub.missingCosts.map((gap) => ({ ...gap, viaSubRecipeId: sub.recipeId, viaSubRecipe: sub.name })),
        );
      }

      lines.push({
        kind: "SUB_RECIPE",
        subRecipeId: ingredient.subRecipeId,
        name: ingredient.subRecipe.name,
        quantity: q(required),
        uomId: ingredient.subRecipe.yieldUomId,
        unitCost: uc(subUnitCost),
        totalCost: tc(lineCost),
        isOptional: ingredient.isOptional,
        wastagePercent: ingredient.wastagePercent,
        breakdown: sub,
      });

      continue;
    }

    if (!ingredient.item) continue;

    // `required` is already in the item's stocking unit and grossed up for the
    // item's prep yield, so the item's own average cost applies directly.
    const itemCost = D(ingredient.item.averageCost);
    const lineCost = itemCost.times(required);

    if (itemCost.isZero()) {
      missingCosts.push({
        itemId: ingredient.item.id,
        sku: ingredient.item.sku,
        name: ingredient.item.name,
        reason: "NO_COST_ON_ITEM",
      });
    }

    lines.push({
      kind: "ITEM",
      itemId: ingredient.item.id,
      sku: ingredient.item.sku,
      name: ingredient.item.name,
      quantity: q(required),
      uomId: ingredient.item.uomId,
      unitCost: uc(itemCost),
      totalCost: tc(lineCost),
      isOptional: ingredient.isOptional,
      wastagePercent: ingredient.wastagePercent,
    });
  }

  const rolled = rollUpCost({
    // An optional ingredient is not part of the standard cost of the dish — it
    // is only there if somebody asks for it.
    ingredientCosts: lines.filter((line) => !line.isOptional).map((line) => line.totalCost),
    laborCost: recipe.laborCost,
    overheadCost: recipe.overheadCost,
    yieldQuantity: recipe.yieldQuantity,
  });

  const result = {
    recipeId: recipe.id,
    name: recipe.name,
    version: recipe.version,
    variantId: recipe.variantId,
    outputItemId: recipe.outputItemId,
    yieldQuantity: recipe.yieldQuantity,
    yieldUomId: recipe.yieldUomId,
    ingredients: lines,
    ...rolled,
    missingCosts,
    // The share of the material cost that is genuinely unknown, so a reader can
    // tell "this dish is cheap" from "we have not priced half of it".
    isFullyCosted: missingCosts.length === 0,
  };

  memo.set(recipeId, result);
  return result;
}

/**
 * Costs a recipe and writes the result back.
 *
 * The cached `computedUnitCost` exists so a menu screen does not walk a
 * six-deep tree per dish. When the recipe makes a sellable variant, the
 * variant's `standardCost` is refreshed too — that is the number an order line
 * snapshots as COGS at sale time, so a stale one misstates the margin on every
 * sale until the next roll-up.
 */
export async function recostRecipe({ recipeId, actor = null, memo = new Map() }) {
  const costed = await costRecipe({ recipeId, memo });
  if (!costed) throw ApiError.notFound("Recipe not found");
  const { isActive } = await prisma.recipe.findUnique({ where: { id: recipeId }, select: { isActive: true } });

  await prisma.$transaction(async (tx) => {
    await tx.recipe.update({
      where: { id: recipeId },
      data: { computedUnitCost: costed.unitCost, costUpdatedAt: new Date() },
    });

    // Only the version in use speaks for the dish. Recosting an old version
    // to look at it must not hand its cost to every sale from now on.
    if (!isActive) return;

    if (costed.variantId) {
      await tx.productVariant.update({
        where: { id: costed.variantId },
        data: { standardCost: tc(costed.unitCost) },
      });
    }

    // A recipe that makes stock sets that item's standard cost only when the
    // item is not already carrying a real, purchased cost — a semi-finished
    // item's cost comes from what production actually spent, not from theory.
    if (costed.outputItemId) {
      const item = await tx.inventoryItem.findUnique({
        where: { id: costed.outputItemId },
        select: { averageCost: true },
      });

      if (item && D(item.averageCost).isZero()) {
        await tx.inventoryItem.update({
          where: { id: costed.outputItemId },
          data: { averageCost: uc(costed.unitCost) },
        });
      }
    }
  });

  logger.info("recipe recosted", {
    recipeId,
    unitCost: Number(costed.unitCost),
    fullyCosted: costed.isFullyCosted,
    actorId: actor?.userId ?? null,
  });

  return costed;
}

/**
 * Recosts a recipe that has just changed, and every live recipe above it.
 *
 * Run after each save, because the cached cost is what a dish's sales are
 * costed at: a chef's edit that waits for someone to press "recost" is a week
 * of sales at last week's cost. A sauce change moves the cost of every dish
 * that uses the sauce, so the walk goes up through the recipes that use it.
 *
 * Never throws. The recipe is saved either way; a failed refresh is logged
 * and the nightly or manual recost puts it right.
 */
export async function refreshRecipeCosts(recipeId, actor = null) {
  const memo = new Map();
  const done = new Set();
  let frontier = [recipeId];

  try {
    for (let depth = 0; frontier.length && depth <= MAX_RECIPE_DEPTH; depth += 1) {
      for (const id of frontier) {
        if (done.has(id)) continue;
        done.add(id);
        // A fresh walk per level: the child's new cost has to be read, not a
        // memo from before it changed.
        await recostRecipe({ recipeId: id, actor, memo: depth === 0 ? memo : new Map() });
      }
      const parents = await prisma.recipeIngredient.findMany({
        where: { subRecipeId: { in: frontier }, recipe: { isActive: true } },
        select: { recipeId: true },
      });
      frontier = [...new Set(parents.map((row) => row.recipeId))].filter((id) => !done.has(id));
    }
  } catch (error) {
    logger.warn("recipe cost refresh failed", { recipeId, error: error.message });
  }
}

/**
 * Recosts every active recipe.
 *
 * Run after a delivery changes ingredient costs, or nightly. Sub-recipes are
 * costed on demand inside the walk and memoised across the whole run, so the
 * order recipes are visited in does not matter and nothing is priced twice.
 */
export async function recostAllRecipes({ onlyActive = true } = {}) {
  const recipes = await prisma.recipe.findMany({
    where: { ...(onlyActive ? { isActive: true } : {}) },
    select: { id: true, isActive: true },
    orderBy: { createdAt: "asc" },
  });

  const memo = new Map();
  const results = [];
  let unpriced = 0;

  for (const recipe of recipes) {
    const costed = await costRecipe({ recipeId: recipe.id, memo });
    if (!costed) continue;

    await prisma.recipe.update({
      where: { id: recipe.id },
      data: { computedUnitCost: costed.unitCost, costUpdatedAt: new Date() },
    });

    if (costed.variantId && recipe.isActive) {
      await prisma.productVariant.update({
        where: { id: costed.variantId },
        data: { standardCost: tc(costed.unitCost) },
      });
    }

    if (!costed.isFullyCosted) unpriced += 1;
    results.push({ recipeId: recipe.id, name: costed.name, unitCost: costed.unitCost });
  }

  return { recosted: results.length, incomplete: unpriced, recipes: results };
}

/**
 * Menu engineering: what each dish costs against what it sells for.
 *
 * Food cost percentage is the number the whole menu is judged on, and the
 * reason it is computed here rather than on a client is that it has to use the
 * same roll-up the kitchen is costed against. Two different answers to "what
 * does this cost" is how a restaurant ends up confidently selling at a loss.
 */
export async function menuCostReport({ branchId = null, categoryId = null, limit = 200 } = {}) {
  const recipes = await prisma.recipe.findMany({
    where: {
      isActive: true,
      variantId: { not: null },
      ...(categoryId ? { variant: { product: { categoryId } } } : {}),
    },
    select: {
      id: true,
      name: true,
      computedUnitCost: true,
      costUpdatedAt: true,
      variant: {
        select: {
          id: true,
          sku: true,
          name: true,
          price: true,
          product: { select: { id: true, name: true, categoryId: true } },
        },
      },
    },
    take: limit,
  });

  const rows = recipes.map((recipe) => {
    const cost = D(recipe.computedUnitCost ?? 0);
    const price = recipe.variant?.price ?? null;

    return {
      recipeId: recipe.id,
      variantId: recipe.variant?.id ?? null,
      sku: recipe.variant?.sku ?? null,
      product: recipe.variant?.product?.name ?? null,
      variant: recipe.variant?.name ?? null,
      price,
      unitCost: uc(cost),
      // Null when never costed: an uncosted dish is unknown, not free.
      foodCostPercent: recipe.computedUnitCost == null ? null : foodCostPercent({ cost, price }),
      contributionMargin: recipe.computedUnitCost == null ? null : contributionMargin({ cost, price }),
      costUpdatedAt: recipe.costUpdatedAt,
      isCosted: recipe.computedUnitCost != null,
    };
  });

  // Worst food cost first — the list is read to find what to reprice.
  return rows.sort((a, b) => (b.foodCostPercent ?? -1) - (a.foodCostPercent ?? -1));
}

/**
 * What one production run of a recipe would cost at today's prices.
 *
 * The standard that a run's actual cost is measured against. Frozen onto the
 * production order when it starts, so the variance compares like with like even
 * if ingredient prices move mid-run.
 */
export async function standardCostForRun({ recipeId, quantity: qty, tx = prisma }) {
  const costed = await costRecipe({ recipeId, tx });
  if (!costed) throw ApiError.notFound("Recipe not found");

  return {
    unitCost: costed.unitCost,
    totalCost: tc(D(costed.unitCost).times(D(qty))),
    materialUnitCost: uc(D(costed.materialCost).dividedBy(D(costed.yieldQuantity).greaterThan(0) ? D(costed.yieldQuantity) : 1)),
    isFullyCosted: costed.isFullyCosted,
    missingCosts: costed.missingCosts,
  };
}

/** Converts a costed line's unit cost into another unit, for display. */
export function displayUnitCost({ unitCost: cost, from, to }) {
  return uc(convertUnitCost({ unitCost: cost, from, to }));
}
