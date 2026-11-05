import { prisma } from "@/lib/prisma";

/**
 * What the recipe and production screens need besides the records: the
 * pickers, and which outputs already have a recipe.
 */

/** Every sellable variant a recipe may make, with the dish it belongs to. */
export async function variantOptions() {
  return prisma.productVariant.findMany({
    where: { product: { deletedAt: null } },
    select: {
      id: true,
      name: true,
      sku: true,
      price: true,
      isActive: true,
      product: { select: { id: true, name: true, isActive: true } },
    },
    orderBy: [{ product: { name: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
    take: 3000,
  });
}

const RECIPE_OPTION_SELECT = {
  id: true,
  name: true,
  version: true,
  isActive: true,
  variantId: true,
  outputItemId: true,
  yieldQuantity: true,
  yieldUomId: true,
  yieldUom: { select: { id: true, code: true, precision: true } },
  outputItem: { select: { id: true, name: true, uomId: true, trackBatches: true, isPerishable: true, shelfLifeDays: true, isActive: true } },
  variant: { select: { id: true, name: true, product: { select: { name: true } } } },
};

/** Live recipes, for choosing a sub-recipe or what to produce. */
export async function recipeOptions() {
  return prisma.recipe.findMany({
    where: { isActive: true },
    select: RECIPE_OPTION_SELECT,
    orderBy: [{ name: "asc" }],
    take: 2000,
  });
}

/** Recipes a production run can make: live, and making a live stock item. */
export async function producibleRecipes() {
  return prisma.recipe.findMany({
    where: { isActive: true, outputItemId: { not: null }, outputItem: { isActive: true } },
    select: RECIPE_OPTION_SELECT,
    orderBy: [{ name: "asc" }],
    take: 2000,
  });
}

/**
 * The live recipe behind each output, keyed `variant:<id>` or `item:<id>`, so
 * the new-recipe form can say "this already has a recipe" before a second
 * one quietly replaces it.
 */
export async function liveRecipeByOutput() {
  const rows = await prisma.recipe.findMany({
    where: { isActive: true },
    select: { id: true, name: true, version: true, variantId: true, outputItemId: true },
  });
  return Object.fromEntries(
    rows.map((row) => [row.variantId ? `variant:${row.variantId}` : `item:${row.outputItemId}`, { id: row.id, name: row.name, version: row.version }]),
  );
}

/** Every version of one output, newest first — the history behind a recipe. */
export async function versionsOf(recipe) {
  return prisma.recipe.findMany({
    where: recipe.variantId ? { variantId: recipe.variantId } : { outputItemId: recipe.outputItemId },
    select: {
      id: true,
      name: true,
      version: true,
      isActive: true,
      createdAt: true,
      createdById: true,
      _count: { select: { ingredients: true, productionOrders: true } },
    },
    orderBy: { version: "desc" },
  });
}

/** Live recipes that use this one inline, so a change is seen for what it touches. */
export async function recipesUsing(recipeId) {
  const rows = await prisma.recipeIngredient.findMany({
    where: { subRecipeId: recipeId },
    select: { recipe: { select: { id: true, name: true, version: true, isActive: true } } },
  });
  return rows.map((row) => row.recipe);
}

/** The stocking unit of each item, for showing quantities a run lists by item id. */
export async function itemUnits(itemIds) {
  const unique = [...new Set(itemIds.filter(Boolean))];
  if (!unique.length) return {};
  const rows = await prisma.inventoryItem.findMany({
    where: { id: { in: unique } },
    select: { id: true, uom: { select: { code: true, precision: true } } },
  });
  return Object.fromEntries(rows.map((row) => [row.id, row.uom]));
}
