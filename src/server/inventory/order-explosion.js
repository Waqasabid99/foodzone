import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { convertQuantity, grossUpForYield } from "@/server/inventory/uom";
import { explodeRecipe, mergeLines } from "@/server/production/explode";

/**
 * What one order consumes, as inventory items and quantities.
 *
 * Its own module because two things need the same answer at two different
 * moments and must never disagree about it: reservation holds stock when the
 * order is placed, and depletion deducts it when the food is made. A hold for
 * 200g against a deduction of 180g leaves 20g held forever, and nothing would
 * ever point at the cause — so there is one explosion, and both import it.
 *
 * Sitting here rather than in either service is also what keeps the two from
 * importing each other: depletion asks reservation to end the holds it is
 * turning into movements, and that dependency only points one way if the
 * shared piece is below both of them.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const UOM_SELECT = { id: true, code: true, type: true, factor: true, baseUnitId: true, precision: true };

/** The live recipe for a variant, if one exists. */
async function recipeForVariant(variantId, tx) {
  if (!variantId) return null;

  return tx.recipe.findFirst({
    where: { variantId, isActive: true },
    select: { id: true },
    orderBy: { version: "desc" },
  });
}

/**
 * Works out everything one order consumed.
 *
 * Exported separately from the posting so a "what would this cost" preview can
 * use it without touching the ledger — and so reservation can hold the same
 * quantities depletion will later deduct. Those two agreeing is the whole
 * point of there being one explosion: a hold for 200g against a deduction of
 * 180g leaves 20g held forever.
 */
export async function explodeOrder({ orderId, tx = prisma }) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      branchId: true,
      items: {
        where: { status: { not: "CANCELLED" } },
        select: {
          id: true,
          variantId: true,
          quantity: true,
          nameSnapshot: true,
          modifiers: { select: { optionId: true, quantity: true } },
        },
      },
    },
  });
  if (!order) return { branchId: null, lines: [] };

  // Collected flat and merged at the end, so an item used by both a recipe and
  // a modifier is deducted once rather than twice.
  const collected = [];
  /*
   * Which dishes each ingredient came from, kept alongside the merge.
   *
   * Only reservation needs it, and only to refuse honestly: "we cannot make
   * your Burger" is something a customer can act on, where the name of the
   * ingredient that ran out is an internal SKU they have never heard of. The
   * merged lines deliberately lose this — one item summed across the order is
   * what deduction wants — so it is gathered here rather than inside
   * `mergeLines`, which costing also uses.
   */
  const dishesByItem = new Map();
  let dish = null;
  const add = (line) => {
    collected.push(line);
    if (!dish) return;
    const dishes = dishesByItem.get(line.itemId) ?? new Set();
    dishes.add(dish);
    dishesByItem.set(line.itemId, dishes);
  };

  for (const orderItem of order.items) {
    dish = orderItem.nameSnapshot ?? null;
    const recipe = await recipeForVariant(orderItem.variantId, tx);

    if (recipe) {
      const lines = await explodeRecipe({ recipeId: recipe.id, multiplier: orderItem.quantity, tx });
      lines.forEach(add);
    }

    // Modifiers consume stock whether or not the dish has a recipe — a plain
    // product with "extra cheese" still uses cheese.
    for (const modifier of orderItem.modifiers) {
      const ingredients = await tx.modifierOptionIngredient.findMany({
        where: { optionId: modifier.optionId },
        select: {
          itemId: true,
          quantity: true,
          uom: { select: UOM_SELECT },
          item: { select: { id: true, name: true, yieldPercent: true, uom: { select: UOM_SELECT } } },
        },
      });

      for (const ingredient of ingredients) {
        const required = D(ingredient.quantity)
          .times(D(modifier.quantity ?? 1))
          .times(D(orderItem.quantity));

        const inStockingUnit = convertQuantity({
          quantity: required,
          from: ingredient.uom,
          to: ingredient.item.uom,
        });

        add({
          itemId: ingredient.itemId,
          quantity: grossUpForYield({ net: inStockingUnit, yieldPercent: ingredient.item.yieldPercent }),
          name: ingredient.item.name,
        });
      }
    }
  }

  return { branchId: order.branchId, lines: mergeLines(collected), dishesByItem };
}

