import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { recordAudit } from "@/server/utils/audit";
import { convertQuantity } from "@/server/inventory/uom";

/**
 * What a modifier costs the store room.
 *
 * "Extra cheese" is 30g of cheese. Without these rows, every add-on a customer
 * chooses is food that leaves the kitchen and never leaves the system, and the
 * usage variance that is supposed to catch portioning drift quietly absorbs it
 * instead — the one number that would reveal the problem is the number the gap
 * hides in.
 *
 * Depletion has read this table since sale-time depletion was built; this is
 * the other half, and until now there was no way to put a row in it.
 *
 * Deliberately not versioned. A modifier is one ingredient at one quantity, not
 * a recipe with a history, and the cost of versioning it is not repaid.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const UOM_SELECT = { id: true, code: true, name: true, type: true, factor: true, baseUnitId: true, precision: true };

const SELECT = {
  id: true,
  optionId: true,
  itemId: true,
  quantity: true,
  uomId: true,
  uom: { select: UOM_SELECT },
  item: {
    select: {
      id: true,
      sku: true,
      name: true,
      uomId: true,
      averageCost: true,
      uom: { select: UOM_SELECT },
    },
  },
};

async function loadOption(optionId) {
  const option = await prisma.modifierOption.findUnique({
    where: { id: optionId },
    select: { id: true, name: true, groupId: true },
  });
  if (!option) throw ApiError.notFound("Modifier option not found");
  return option;
}

export async function listModifierIngredients(optionId) {
  await loadOption(optionId);

  const rows = await prisma.modifierOptionIngredient.findMany({
    where: { optionId },
    select: SELECT,
    orderBy: { id: "asc" },
  });

  return rows.map((row) => ({
    ...row,
    // The stocking-unit quantity is what actually gets deducted, so it is shown
    // next to what was typed — 30 g against an item stocked in kg is 0.03.
    stockingQuantity: convertQuantity({ quantity: row.quantity, from: row.uom, to: row.item.uom }),
    estimatedCost: convertQuantity({ quantity: row.quantity, from: row.uom, to: row.item.uom }).times(
      D(row.item.averageCost),
    ),
  }));
}

/**
 * Adds or updates one ingredient on a modifier option.
 *
 * Upserted on `(optionId, itemId)` because "extra cheese uses cheese" is a
 * single fact — a second POST is somebody correcting the quantity, not adding a
 * second cheese line.
 */
export async function setModifierIngredient(optionId, data, actor = null) {
  const option = await loadOption(optionId);

  const item = await prisma.inventoryItem.findUnique({
    where: { id: data.itemId },
    select: { id: true, name: true, isActive: true, uomId: true, uom: { select: UOM_SELECT } },
  });
  if (!item) throw ApiError.validation("Inventory item not found", { itemId: ["No such item"] });
  if (!item.isActive) {
    throw ApiError.validation(`${item.name} is not active`, { itemId: ["Reactivate the item or choose another"] });
  }

  if (D(data.quantity).lessThanOrEqualTo(0)) {
    throw ApiError.validation("A modifier quantity must be more than zero", {
      quantity: ["Must be greater than zero. Remove the line instead."],
    });
  }

  const uom = data.uomId
    ? await prisma.unitOfMeasure.findUnique({ where: { id: data.uomId }, select: UOM_SELECT })
    : item.uom;
  if (!uom) throw ApiError.validation("Unit not found", { uomId: ["No such unit"] });

  // Proved convertible now, so depletion can never fail at sale time.
  convertQuantity({ quantity: 1, from: uom, to: item.uom });

  const row = await prisma.modifierOptionIngredient.upsert({
    where: { optionId_itemId: { optionId, itemId: item.id } },
    create: { optionId, itemId: item.id, quantity: D(data.quantity), uomId: uom.id },
    update: { quantity: D(data.quantity), uomId: uom.id },
    select: SELECT,
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "modifier_ingredient.set",
    entityType: "ModifierOption",
    entityId: optionId,
    changes: { option: option.name, item: item.name, quantity: Number(data.quantity), uom: uom.code },
  });

  return row;
}

export async function removeModifierIngredient(optionId, itemId, actor = null) {
  const existing = await prisma.modifierOptionIngredient.findUnique({
    where: { optionId_itemId: { optionId, itemId } },
    select: { id: true },
  });
  if (!existing) throw ApiError.notFound("That ingredient is not on this modifier");

  await prisma.modifierOptionIngredient.delete({ where: { id: existing.id } });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "modifier_ingredient.remove",
    entityType: "ModifierOption",
    entityId: optionId,
    changes: { itemId },
  });

  return { optionId, itemId, deleted: true };
}

/**
 * What the add-ons on a dish cost.
 *
 * Menu costing that stops at the recipe understates every dish a customer
 * customises, and add-ons are where a lot of the margin actually is.
 */
export async function modifierCostReport({ groupId = null } = {}) {
  const rows = await prisma.modifierOptionIngredient.findMany({
    where: { ...(groupId ? { option: { groupId } } : {}) },
    select: {
      ...SELECT,
      option: {
        select: {
          id: true,
          name: true,
          priceDelta: true,
          group: { select: { id: true, name: true } },
        },
      },
    },
  });

  const byOption = new Map();

  for (const row of rows) {
    const inStockingUnit = convertQuantity({ quantity: row.quantity, from: row.uom, to: row.item.uom });
    const cost = inStockingUnit.times(D(row.item.averageCost));

    const bucket = byOption.get(row.optionId) ?? {
      optionId: row.optionId,
      option: row.option.name,
      group: row.option.group?.name ?? null,
      priceDelta: row.option.priceDelta,
      cost: D(0),
      ingredients: [],
    };

    bucket.cost = bucket.cost.plus(cost);
    bucket.ingredients.push({
      itemId: row.itemId,
      name: row.item.name,
      quantity: row.quantity,
      uom: row.uom.code,
      cost,
    });

    byOption.set(row.optionId, bucket);
  }

  return [...byOption.values()]
    .map((bucket) => ({
      ...bucket,
      // Negative when an add-on is priced below what it costs — which is the
      // whole reason to look at this list.
      margin: D(bucket.priceDelta).minus(bucket.cost),
    }))
    .sort((a, b) => Number(D(a.margin).minus(D(b.margin))));
}
