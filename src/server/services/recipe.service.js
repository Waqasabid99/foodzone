import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { convertQuantity } from "@/server/inventory/uom";
import { MAX_RECIPE_DEPTH } from "@/server/production/explode";

/**
 * Recipes — the bill of materials for everything the kitchen makes.
 *
 * A recipe produces exactly one of two things, and which one decides how stock
 * behaves around it:
 *
 *   * a **ProductVariant** — a sellable dish. Nothing is made in advance; the
 *     recipe is exploded at sale time and raw stock is deducted then.
 *   * an **InventoryItem** — usually SEMI_FINISHED. A sauce, a dough, a stock.
 *     These are made by a production run, become stock in their own right, and
 *     are then ingredients in other recipes.
 *
 * Three rules run through the module:
 *
 *   * **Versions are immutable once used.** A recipe that has been produced
 *     against is the record of what was made and what it cost. Editing it in
 *     place would silently rewrite history and change every past variance. An
 *     edit to a used recipe creates version n+1 instead, and the old version
 *     stays exactly as it was.
 *   * **One active version per output.** Depletion and costing both need an
 *     unambiguous answer to "what is the current recipe for this dish".
 *   * **Units are validated on the way in.** A recipe line in litres against an
 *     item stocked by weight is refused here, where a chef can fix it, rather
 *     than at midnight when a sale tries to deduct it.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const UOM_SELECT = { id: true, code: true, name: true, type: true, factor: true, baseUnitId: true, precision: true };

const INGREDIENT_SELECT = {
  id: true,
  itemId: true,
  subRecipeId: true,
  quantity: true,
  uomId: true,
  wastagePercent: true,
  isOptional: true,
  sortOrder: true,
  note: true,
  uom: { select: UOM_SELECT },
  item: { select: { id: true, sku: true, name: true, type: true, uomId: true, uom: { select: UOM_SELECT } } },
  subRecipe: { select: { id: true, name: true, version: true, yieldUomId: true } },
};

const SELECT = {
  id: true,
  name: true,
  variantId: true,
  outputItemId: true,
  yieldQuantity: true,
  yieldUomId: true,
  version: true,
  isActive: true,
  isBatchProduced: true,
  prepTimeMinutes: true,
  cookTimeMinutes: true,
  instructions: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  yieldUom: { select: UOM_SELECT },
  variant: { select: { id: true, sku: true, name: true, price: true, product: { select: { id: true, name: true } } } },
  outputItem: { select: { id: true, sku: true, name: true, type: true, uomId: true } },
  ingredients: { select: INGREDIENT_SELECT, orderBy: { sortOrder: "asc" } },
};

/** Costing fields, split out so they can be withheld without a second query. */
const COST_FIELDS = ["laborCost", "overheadCost", "computedUnitCost", "costUpdatedAt"];

const COST_SELECT = { laborCost: true, overheadCost: true, computedUnitCost: true, costUpdatedAt: true };

/**
 * Strips costing from a recipe for a caller without `recipes.view_cost`.
 *
 * Ingredient costs are a competitive secret and a payroll-adjacent one — a
 * kitchen porter who can read a menu should not be able to read its margin.
 */
export function withoutCosts(recipe) {
  if (!recipe) return recipe;
  const stripped = { ...recipe };
  for (const field of COST_FIELDS) delete stripped[field];
  return stripped;
}

function selectFor({ includeCost = false } = {}) {
  return includeCost ? { ...SELECT, ...COST_SELECT } : SELECT;
}

/** Exactly one output, and it has to exist. */
async function resolveOutput({ variantId, outputItemId }) {
  const named = [variantId, outputItemId].filter(Boolean);

  if (named.length !== 1) {
    throw ApiError.validation("A recipe makes exactly one thing", {
      variantId: ["Give either a product variant or an inventory item, not both and not neither"],
    });
  }

  if (variantId) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true, name: true, sku: true },
    });
    if (!variant) throw ApiError.validation("Product variant not found", { variantId: ["No such variant"] });
    return { variantId, outputItemId: null, label: variant.name };
  }

  const item = await prisma.inventoryItem.findUnique({
    where: { id: outputItemId },
    select: { id: true, name: true, type: true, uomId: true, uom: { select: UOM_SELECT } },
  });
  if (!item) throw ApiError.validation("Inventory item not found", { outputItemId: ["No such item"] });

  if (item.type === "RAW_MATERIAL") {
    // A raw material is bought, not made. Letting a recipe produce one hides a
    // modelling mistake that only shows up as impossible stock later.
    throw ApiError.validation(`${item.name} is a raw material, so it cannot be produced by a recipe`, {
      outputItemId: ["Change the item's type to SEMI_FINISHED or FINISHED_GOOD first"],
    });
  }

  return { variantId: null, outputItemId, label: item.name, outputItem: item };
}

/**
 * Validates the lines and normalises them for storage.
 *
 * The unit checks are the point of this function. Each line is proved
 * convertible into the unit it will eventually be measured in — the item's
 * stocking unit for a real ingredient, the sub-recipe's yield unit for a nested
 * one — so an impossible recipe cannot be saved at all.
 */
async function prepareIngredients({ lines, recipeId = null }) {
  if (!lines?.length) {
    throw ApiError.validation("A recipe needs at least one ingredient", { ingredients: ["Add an ingredient"] });
  }

  const itemIds = [...new Set(lines.map((line) => line.itemId).filter(Boolean))];
  const subRecipeIds = [...new Set(lines.map((line) => line.subRecipeId).filter(Boolean))];
  const uomIds = [...new Set(lines.map((line) => line.uomId).filter(Boolean))];

  const [items, subRecipes, uoms] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, name: true, isActive: true, uomId: true, uom: { select: UOM_SELECT } },
    }),
    prisma.recipe.findMany({
      where: { id: { in: subRecipeIds } },
      select: { id: true, name: true, yieldUomId: true, yieldUom: { select: UOM_SELECT } },
    }),
    prisma.unitOfMeasure.findMany({ where: { id: { in: uomIds } }, select: UOM_SELECT }),
  ]);

  const itemById = new Map(items.map((item) => [item.id, item]));
  const subById = new Map(subRecipes.map((sub) => [sub.id, sub]));
  const uomById = new Map(uoms.map((uom) => [uom.id, uom]));

  const seen = new Set();

  return lines.map((line, index) => {
    const named = [line.itemId, line.subRecipeId].filter(Boolean);
    if (named.length !== 1) {
      throw ApiError.validation("Each ingredient is either an item or a sub-recipe", {
        [`ingredients.${index}`]: ["Give exactly one of itemId or subRecipeId"],
      });
    }

    if (D(line.quantity).lessThanOrEqualTo(0)) {
      throw ApiError.validation("An ingredient quantity must be more than zero", {
        [`ingredients.${index}.quantity`]: ["Must be greater than zero"],
      });
    }

    // The same ingredient twice is almost always a duplicate paste, and it
    // doubles the cost of the dish without looking wrong on screen.
    const key = line.itemId ?? line.subRecipeId;
    if (seen.has(key)) {
      throw ApiError.validation("That ingredient is on the recipe twice", {
        [`ingredients.${index}`]: ["Combine the two lines into one"],
      });
    }
    seen.add(key);

    if (line.subRecipeId) {
      const sub = subById.get(line.subRecipeId);
      if (!sub) {
        throw ApiError.validation("Sub-recipe not found", {
          [`ingredients.${index}.subRecipeId`]: ["No such recipe"],
        });
      }
      if (recipeId && sub.id === recipeId) {
        throw ApiError.validation("A recipe cannot include itself", {
          [`ingredients.${index}.subRecipeId`]: ["Remove this line"],
        });
      }

      const uom = line.uomId ? uomById.get(line.uomId) : sub.yieldUom;
      if (!uom) throw ApiError.validation("Unit not found", { [`ingredients.${index}.uomId`]: ["No such unit"] });

      // Measured against what the sub-recipe actually yields.
      convertQuantity({ quantity: 1, from: uom, to: sub.yieldUom });

      return {
        itemId: null,
        subRecipeId: sub.id,
        quantity: D(line.quantity),
        uomId: uom.id,
        wastagePercent: D(line.wastagePercent ?? 0),
        isOptional: line.isOptional ?? false,
        sortOrder: line.sortOrder ?? index,
        note: line.note ?? null,
      };
    }

    const item = itemById.get(line.itemId);
    if (!item) {
      throw ApiError.validation("Ingredient not found", { [`ingredients.${index}.itemId`]: ["No such item"] });
    }
    if (!item.isActive) {
      throw ApiError.validation(`${item.name} is not active`, {
        [`ingredients.${index}.itemId`]: ["Reactivate the item or choose another"],
      });
    }

    const uom = line.uomId ? uomById.get(line.uomId) : item.uom;
    if (!uom) throw ApiError.validation("Unit not found", { [`ingredients.${index}.uomId`]: ["No such unit"] });

    // Proved convertible now, so the explosion can never fail at sale time.
    convertQuantity({ quantity: 1, from: uom, to: item.uom });

    return {
      itemId: item.id,
      subRecipeId: null,
      quantity: D(line.quantity),
      uomId: uom.id,
      wastagePercent: D(line.wastagePercent ?? 0),
      isOptional: line.isOptional ?? false,
      sortOrder: line.sortOrder ?? index,
      note: line.note ?? null,
    };
  });
}

/**
 * Refuses a set of sub-recipes that would eventually lead back to `recipeId`.
 *
 * A cycle is not a theoretical worry: "dough" using "starter" using "dough" is
 * a plausible mistake in a bakery, and it makes both costing and depletion
 * recurse until something dies. Caught at save time, where it is one bad line
 * rather than a nightly job that stops working.
 */
export async function assertNoCycle({ recipeId, subRecipeIds, tx = prisma }) {
  if (!recipeId || !subRecipeIds.length) return;

  const visited = new Set();
  let frontier = [...subRecipeIds];
  let depth = 0;

  while (frontier.length) {
    if (depth > MAX_RECIPE_DEPTH) {
      throw ApiError.validation("These ingredients nest too deeply", {
        ingredients: [`Sub-recipes may nest at most ${MAX_RECIPE_DEPTH} deep`],
      });
    }

    if (frontier.includes(recipeId)) {
      throw ApiError.validation("That would make the recipe include itself", {
        ingredients: ["One of these sub-recipes eventually uses this recipe"],
      });
    }

    frontier.forEach((id) => visited.add(id));

    const next = await tx.recipeIngredient.findMany({
      where: { recipeId: { in: frontier }, subRecipeId: { not: null } },
      select: { subRecipeId: true },
    });

    frontier = [...new Set(next.map((row) => row.subRecipeId))].filter((id) => !visited.has(id));
    depth += 1;
  }
}

/** Only one version of a recipe is live at a time. */
async function deactivateOtherVersions(tx, { variantId, outputItemId, keepId }) {
  await tx.recipe.updateMany({
    where: {
      ...(variantId ? { variantId } : { outputItemId }),
      id: { not: keepId },
      isActive: true,
    },
    data: { isActive: false },
  });
}

async function nextVersionFor(tx, { variantId, outputItemId }) {
  const latest = await tx.recipe.findFirst({
    where: variantId ? { variantId } : { outputItemId },
    select: { version: true },
    orderBy: { version: "desc" },
  });

  return (latest?.version ?? 0) + 1;
}

/** The yield unit has to measure the same kind of thing the output is stocked in. */
function assertYieldUnitFits({ yieldUom, outputItem }) {
  if (!outputItem) return;
  convertQuantity({ quantity: 1, from: yieldUom, to: outputItem.uom });
}

export async function createRecipe(data, actor = null) {
  const output = await resolveOutput(data);

  const yieldUom = await prisma.unitOfMeasure.findUnique({ where: { id: data.yieldUomId }, select: UOM_SELECT });
  if (!yieldUom) throw ApiError.validation("Yield unit not found", { yieldUomId: ["No such unit"] });
  assertYieldUnitFits({ yieldUom, outputItem: output.outputItem });

  if (D(data.yieldQuantity ?? 1).lessThanOrEqualTo(0)) {
    throw ApiError.validation("A recipe has to yield something", { yieldQuantity: ["Must be greater than zero"] });
  }

  const ingredients = await prepareIngredients({ lines: data.ingredients });

  const recipe = await withTransaction(async (tx) => {
    const version = await nextVersionFor(tx, output);

    const created = await tx.recipe.create({
      data: {
        name: data.name,
        variantId: output.variantId,
        outputItemId: output.outputItemId,
        yieldQuantity: D(data.yieldQuantity ?? 1),
        yieldUomId: yieldUom.id,
        version,
        isActive: data.isActive ?? true,
        isBatchProduced: data.isBatchProduced ?? false,
        prepTimeMinutes: data.prepTimeMinutes ?? null,
        cookTimeMinutes: data.cookTimeMinutes ?? null,
        instructions: data.instructions ?? null,
        laborCost: D(data.laborCost ?? 0),
        overheadCost: D(data.overheadCost ?? 0),
        createdById: actor?.userId ?? null,
        ingredients: { create: ingredients },
      },
      select: selectFor({ includeCost: true }),
    });

    await assertNoCycle({
      recipeId: created.id,
      subRecipeIds: ingredients.map((line) => line.subRecipeId).filter(Boolean),
      tx,
    });

    if (created.isActive) await deactivateOtherVersions(tx, { ...output, keepId: created.id });

    return created;
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "recipe.create",
    entityType: "Recipe",
    entityId: recipe.id,
    changes: { name: recipe.name, version: recipe.version, ingredients: ingredients.length },
  });

  return recipe;
}

async function loadRecipe(id, { includeCost = true } = {}) {
  const recipe = await prisma.recipe.findUnique({ where: { id }, select: selectFor({ includeCost }) });
  if (!recipe) throw ApiError.notFound("Recipe not found");
  return recipe;
}

/** Has this version been produced against, or sold through? */
async function usageOf(id) {
  const [productionOrders, usedAsSubRecipe] = await Promise.all([
    prisma.productionOrder.count({ where: { recipeId: id } }),
    prisma.recipeIngredient.count({ where: { subRecipeId: id } }),
  ]);

  return { productionOrders, usedAsSubRecipe, isUsed: productionOrders > 0 };
}

/**
 * Edits a recipe in place.
 *
 * Only while it has no production history. Once a run has been costed against
 * this version, the version *is* that history — changing it would move every
 * past variance without leaving a trace. The caller is pointed at
 * `reviseRecipe`, which is the honest way to change a recipe that is in use.
 */
export async function updateRecipe(id, data, actor = null) {
  const recipe = await loadRecipe(id);
  const usage = await usageOf(id);

  if (usage.isUsed && (data.ingredients || data.yieldQuantity != null || data.yieldUomId)) {
    throw ApiError.conflict(
      "This recipe has already been produced against, so its ingredients and yield cannot be changed",
      { hint: "POST /admin/recipes/{id}/revise creates a new version instead", productionOrders: usage.productionOrders },
    );
  }

  const ingredients = data.ingredients ? await prepareIngredients({ lines: data.ingredients, recipeId: id }) : null;

  const yieldUom = data.yieldUomId
    ? await prisma.unitOfMeasure.findUnique({ where: { id: data.yieldUomId }, select: UOM_SELECT })
    : null;
  if (data.yieldUomId && !yieldUom) {
    throw ApiError.validation("Yield unit not found", { yieldUomId: ["No such unit"] });
  }

  const updated = await withTransaction(async (tx) => {
    if (ingredients) {
      await assertNoCycle({
        recipeId: id,
        subRecipeIds: ingredients.map((line) => line.subRecipeId).filter(Boolean),
        tx,
      });

      await tx.recipeIngredient.deleteMany({ where: { recipeId: id } });
      await tx.recipeIngredient.createMany({ data: ingredients.map((line) => ({ ...line, recipeId: id })) });
    }

    const row = await tx.recipe.update({
      where: { id },
      data: {
        ...(data.name != null ? { name: data.name } : {}),
        ...(data.yieldQuantity != null ? { yieldQuantity: D(data.yieldQuantity) } : {}),
        ...(yieldUom ? { yieldUomId: yieldUom.id } : {}),
        ...(data.isBatchProduced != null ? { isBatchProduced: data.isBatchProduced } : {}),
        ...(data.prepTimeMinutes !== undefined ? { prepTimeMinutes: data.prepTimeMinutes } : {}),
        ...(data.cookTimeMinutes !== undefined ? { cookTimeMinutes: data.cookTimeMinutes } : {}),
        ...(data.instructions !== undefined ? { instructions: data.instructions } : {}),
        ...(data.laborCost != null ? { laborCost: D(data.laborCost) } : {}),
        ...(data.overheadCost != null ? { overheadCost: D(data.overheadCost) } : {}),
        ...(data.isActive != null ? { isActive: data.isActive } : {}),
        // Any change invalidates the stored roll-up. Cleared rather than
        // recomputed here, so a stale number is never mistaken for a fresh one.
        ...(ingredients || data.laborCost != null || data.overheadCost != null || data.yieldQuantity != null
          ? { computedUnitCost: null, costUpdatedAt: null }
          : {}),
      },
      select: selectFor({ includeCost: true }),
    });

    if (row.isActive) {
      await deactivateOtherVersions(tx, {
        variantId: row.variantId,
        outputItemId: row.outputItemId,
        keepId: row.id,
      });
    }

    return row;
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "recipe.update",
    entityType: "Recipe",
    entityId: id,
    changes: { name: updated.name, version: updated.version, ingredientsReplaced: Boolean(ingredients) },
  });

  return updated;
}

/**
 * Creates the next version of a recipe.
 *
 * The changes are applied on top of a copy; anything not given is carried over.
 * The old version is deactivated but kept, so a production run from last month
 * still points at exactly the recipe it was made from.
 */
export async function reviseRecipe(id, data = {}, actor = null) {
  const current = await loadRecipe(id);

  const merged = {
    name: data.name ?? current.name,
    yieldQuantity: data.yieldQuantity ?? current.yieldQuantity,
    yieldUomId: data.yieldUomId ?? current.yieldUomId,
    isBatchProduced: data.isBatchProduced ?? current.isBatchProduced,
    prepTimeMinutes: data.prepTimeMinutes ?? current.prepTimeMinutes,
    cookTimeMinutes: data.cookTimeMinutes ?? current.cookTimeMinutes,
    instructions: data.instructions ?? current.instructions,
    laborCost: data.laborCost ?? current.laborCost,
    overheadCost: data.overheadCost ?? current.overheadCost,
    ingredients:
      data.ingredients ??
      current.ingredients.map((line) => ({
        itemId: line.itemId,
        subRecipeId: line.subRecipeId,
        quantity: Number(line.quantity),
        uomId: line.uomId,
        wastagePercent: Number(line.wastagePercent),
        isOptional: line.isOptional,
        sortOrder: line.sortOrder,
        note: line.note,
      })),
  };

  const ingredients = await prepareIngredients({ lines: merged.ingredients });

  const revised = await withTransaction(async (tx) => {
    const version = await nextVersionFor(tx, {
      variantId: current.variantId,
      outputItemId: current.outputItemId,
    });

    const created = await tx.recipe.create({
      data: {
        name: merged.name,
        variantId: current.variantId,
        outputItemId: current.outputItemId,
        yieldQuantity: D(merged.yieldQuantity),
        yieldUomId: merged.yieldUomId,
        version,
        isActive: true,
        isBatchProduced: merged.isBatchProduced,
        prepTimeMinutes: merged.prepTimeMinutes,
        cookTimeMinutes: merged.cookTimeMinutes,
        instructions: merged.instructions,
        laborCost: D(merged.laborCost),
        overheadCost: D(merged.overheadCost),
        createdById: actor?.userId ?? null,
        ingredients: { create: ingredients },
      },
      select: selectFor({ includeCost: true }),
    });

    await assertNoCycle({
      recipeId: created.id,
      subRecipeIds: ingredients.map((line) => line.subRecipeId).filter(Boolean),
      tx,
    });

    await deactivateOtherVersions(tx, {
      variantId: current.variantId,
      outputItemId: current.outputItemId,
      keepId: created.id,
    });

    return created;
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "recipe.revise",
    entityType: "Recipe",
    entityId: revised.id,
    changes: { from: { id: current.id, version: current.version }, to: revised.version },
  });

  return revised;
}

/**
 * Makes one version the live one.
 *
 * The way to roll back a bad revision: the new version is not deleted, the old
 * one is simply made current again.
 */
export async function activateRecipeVersion(id, actor = null) {
  const recipe = await loadRecipe(id);

  const activated = await withTransaction(async (tx) => {
    await deactivateOtherVersions(tx, {
      variantId: recipe.variantId,
      outputItemId: recipe.outputItemId,
      keepId: id,
    });

    return tx.recipe.update({ where: { id }, data: { isActive: true }, select: selectFor({ includeCost: true }) });
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "recipe.activate",
    entityType: "Recipe",
    entityId: id,
    changes: { version: recipe.version },
  });

  return activated;
}

/**
 * Deletes a recipe.
 *
 * Refused once anything depends on it. A recipe referenced by a production run
 * is that run's explanation of what it made, and a recipe used as a sub-recipe
 * is holding up someone else's costing. Deactivation is the answer in both
 * cases — it stops the recipe being used without erasing what it explains.
 */
export async function deleteRecipe(id, actor = null) {
  const recipe = await loadRecipe(id);
  const usage = await usageOf(id);

  if (usage.productionOrders > 0) {
    throw ApiError.conflict("This recipe has been produced against, so it cannot be deleted", {
      productionOrders: usage.productionOrders,
      hint: "Deactivate it instead",
    });
  }

  if (usage.usedAsSubRecipe > 0) {
    throw ApiError.conflict("This recipe is an ingredient in another recipe", {
      usedIn: usage.usedAsSubRecipe,
      hint: "Remove it from those recipes first",
    });
  }

  await prisma.recipe.delete({ where: { id } });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "recipe.delete",
    entityType: "Recipe",
    entityId: id,
    changes: { name: recipe.name, version: recipe.version },
  });

  return { id, deleted: true };
}

export async function listRecipes({
  search,
  variantId,
  outputItemId,
  isActive,
  isBatchProduced,
  includeCost = false,
  limit = 20,
  cursor,
} = {}) {
  const rows = await prisma.recipe.findMany({
    where: {
      ...(variantId ? { variantId } : {}),
      ...(outputItemId ? { outputItemId } : {}),
      ...(isActive != null ? { isActive } : {}),
      ...(isBatchProduced != null ? { isBatchProduced } : {}),
      ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
    },
    select: {
      id: true,
      name: true,
      variantId: true,
      outputItemId: true,
      version: true,
      isActive: true,
      isBatchProduced: true,
      yieldQuantity: true,
      yieldUom: { select: { id: true, code: true } },
      variant: { select: { id: true, sku: true, name: true } },
      outputItem: { select: { id: true, sku: true, name: true } },
      _count: { select: { ingredients: true } },
      ...(includeCost ? { computedUnitCost: true, costUpdatedAt: true } : {}),
    },
    orderBy: [{ name: "asc" }, { version: "desc" }],
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);
  return {
    ...page,
    items: page.items.map(({ _count, ...row }) => ({ ...row, ingredientCount: _count.ingredients })),
  };
}

export async function getRecipe(id, { includeCost = false } = {}) {
  const recipe = await loadRecipe(id, { includeCost });
  const usage = await usageOf(id);

  return { ...recipe, usage };
}

/** Every version of one output, newest first — the history behind a dish. */
export async function recipeVersions({ variantId, outputItemId, includeCost = false }) {
  if (!variantId && !outputItemId) {
    throw ApiError.validation("Say whose versions you want", {
      variantId: ["Give a variantId or an outputItemId"],
    });
  }

  return prisma.recipe.findMany({
    where: variantId ? { variantId } : { outputItemId },
    select: {
      id: true,
      name: true,
      version: true,
      isActive: true,
      yieldQuantity: true,
      createdAt: true,
      createdById: true,
      _count: { select: { ingredients: true, productionOrders: true } },
      ...(includeCost ? { computedUnitCost: true, costUpdatedAt: true } : {}),
    },
    orderBy: { version: "desc" },
  });
}

/** The live recipe for a variant, if one exists. Shared by depletion and costing. */
export async function activeRecipeForVariant(variantId, tx = prisma) {
  if (!variantId) return null;

  return tx.recipe.findFirst({
    where: { variantId, isActive: true },
    select: { id: true },
    orderBy: { version: "desc" },
  });
}
