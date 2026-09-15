import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";

/**
 * Units of measure.
 *
 * Small module, load-bearing for everything else: a wrong conversion factor
 * misprices every recipe that touches the unit, and does it silently.
 *
 * A unit either *is* a base (no `baseUnitId`) or converts to one of the same
 * type. Chains are deliberately not allowed — g → kg → tonne would mean the
 * factor depends on how far you walk, and one bad link corrupts everything
 * downstream of it.
 */

const SELECT = {
  id: true,
  code: true,
  name: true,
  type: true,
  baseUnitId: true,
  factor: true,
  precision: true,
  isActive: true,
  baseUnit: { select: { id: true, code: true, name: true } },
};

export async function listUnits({ type, isActive } = {}) {
  return prisma.unitOfMeasure.findMany({
    where: { ...(type ? { type } : {}), ...(isActive !== undefined ? { isActive } : {}) },
    select: { ...SELECT, _count: { select: { items: true, derived: true } } },
    orderBy: [{ type: "asc" }, { code: "asc" }],
  });
}

export async function getUnit(id) {
  const unit = await prisma.unitOfMeasure.findUnique({ where: { id }, select: SELECT });
  if (!unit) throw ApiError.notFound("Unit not found");
  return unit;
}

async function assertBaseIsValid({ baseUnitId, type, selfId = null }) {
  if (!baseUnitId) return;
  if (baseUnitId === selfId) {
    throw ApiError.validation("A unit cannot convert to itself", { baseUnitId: ["Choose a different base unit"] });
  }

  const base = await prisma.unitOfMeasure.findUnique({
    where: { id: baseUnitId },
    select: { id: true, type: true, baseUnitId: true, code: true },
  });
  if (!base) throw ApiError.validation("Base unit not found", { baseUnitId: ["No such unit"] });

  if (base.type !== type) {
    throw ApiError.validation("A unit can only convert within its own type", {
      baseUnitId: [`${base.code} measures ${base.type.toLowerCase()}, not ${String(type).toLowerCase()}`],
    });
  }

  // One hop only. A chain would make the effective factor depend on traversal
  // depth, and every consumer would have to walk it correctly.
  if (base.baseUnitId) {
    throw ApiError.validation("Convert to a base unit directly, not through another derived unit", {
      baseUnitId: [`${base.code} already converts to another unit`],
    });
  }
}

export async function createUnit(data) {
  const code = data.code.trim();
  const clash = await prisma.unitOfMeasure.findUnique({ where: { code }, select: { id: true } });
  if (clash) throw ApiError.conflict(`A unit with code "${code}" already exists`);

  await assertBaseIsValid({ baseUnitId: data.baseUnitId, type: data.type });

  if (data.baseUnitId && Number(data.factor ?? 0) <= 0) {
    throw ApiError.validation("A conversion factor must be greater than zero", {
      factor: ["How many base units are in one of this unit?"],
    });
  }

  return prisma.unitOfMeasure.create({ data: { ...data, code }, select: SELECT });
}

/**
 * Editing a unit's factor is refused once it has been used.
 *
 * Past movements stored quantities already converted through the old factor, so
 * changing it now would not move them — it would only make every future line
 * disagree with the history. Create a new unit instead.
 */
export async function updateUnit(id, data) {
  const unit = await prisma.unitOfMeasure.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      factor: true,
      _count: { select: { stockMovements: true, items: true, recipeIngredients: true } },
    },
  });
  if (!unit) throw ApiError.notFound("Unit not found");

  const inUse = unit._count.stockMovements > 0 || unit._count.items > 0 || unit._count.recipeIngredients > 0;
  const changesConversion =
    (data.factor !== undefined && !String(data.factor).startsWith(String(unit.factor))) ||
    data.baseUnitId !== undefined ||
    data.type !== undefined;

  if (inUse && changesConversion) {
    throw ApiError.conflict(
      "This unit is already in use. Its conversion cannot change, because past quantities were stored using it.",
      { movements: unit._count.stockMovements, items: unit._count.items },
    );
  }

  if (data.code) {
    const clash = await prisma.unitOfMeasure.findFirst({
      where: { code: data.code.trim(), id: { not: id } },
      select: { id: true },
    });
    if (clash) throw ApiError.conflict(`A unit with code "${data.code}" already exists`);
  }

  await assertBaseIsValid({
    baseUnitId: data.baseUnitId,
    type: data.type ?? unit.type,
    selfId: id,
  });

  return prisma.unitOfMeasure.update({ where: { id }, data, select: SELECT });
}

export async function deleteUnit(id) {
  const unit = await prisma.unitOfMeasure.findUnique({
    where: { id },
    select: {
      id: true,
      _count: { select: { items: true, stockMovements: true, derived: true, recipeIngredients: true } },
    },
  });
  if (!unit) throw ApiError.notFound("Unit not found");

  const used =
    unit._count.items + unit._count.stockMovements + unit._count.derived + unit._count.recipeIngredients;
  if (used > 0) {
    throw ApiError.conflict("This unit is in use. Deactivate it instead of deleting it.", {
      items: unit._count.items,
      movements: unit._count.stockMovements,
      derivedUnits: unit._count.derived,
    });
  }

  await prisma.unitOfMeasure.delete({ where: { id } });
  return { deleted: true, id };
}

// --- inventory categories ---------------------------------------------------

const CATEGORY_SELECT = { id: true, name: true, code: true, isActive: true };

export async function listInventoryCategories({ isActive } = {}) {
  const rows = await prisma.inventoryCategory.findMany({
    where: { ...(isActive !== undefined ? { isActive } : {}) },
    select: { ...CATEGORY_SELECT, _count: { select: { items: true } } },
    orderBy: { name: "asc" },
  });

  return rows.map(({ _count, ...row }) => ({ ...row, itemCount: _count.items }));
}

export async function createInventoryCategory(data) {
  const clash = await prisma.inventoryCategory.findUnique({ where: { name: data.name }, select: { id: true } });
  if (clash) throw ApiError.conflict(`A category called "${data.name}" already exists`);

  return prisma.inventoryCategory.create({ data, select: CATEGORY_SELECT });
}

export async function updateInventoryCategory(id, data) {
  const category = await prisma.inventoryCategory.findUnique({ where: { id }, select: { id: true } });
  if (!category) throw ApiError.notFound("Category not found");

  return prisma.inventoryCategory.update({ where: { id }, data, select: CATEGORY_SELECT });
}

/** Deleting a category only unassigns its items — it never removes stock. */
export async function deleteInventoryCategory(id) {
  const category = await prisma.inventoryCategory.findUnique({ where: { id }, select: { id: true } });
  if (!category) throw ApiError.notFound("Category not found");

  await prisma.inventoryCategory.delete({ where: { id } });
  return { deleted: true, id };
}
