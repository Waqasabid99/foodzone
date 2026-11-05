import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";

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

  // A base unit's factor is 1 by definition, and `factorOf` ignores whatever
  // is stored there. Storing the 1000 someone typed would make the screen say
  // one thing and every conversion do another.
  return prisma.unitOfMeasure.create({
    data: { ...data, code, factor: data.baseUnitId ? data.factor : 1 },
    select: SELECT,
  });
}

/**
 * The units nearly every kitchen needs, created if missing.
 *
 * Weight and volume are based on the gram and the millilitre, the smallest
 * units a recipe card uses, so a recipe never needs a fraction of a base unit.
 * Existing codes are left alone — this fills gaps, it does not overwrite.
 */
export const STANDARD_UNITS = [
  { code: "g", name: "Gram", type: "WEIGHT", precision: 1 },
  { code: "kg", name: "Kilogram", type: "WEIGHT", base: "g", factor: 1000, precision: 3 },
  { code: "ml", name: "Millilitre", type: "VOLUME", precision: 0 },
  { code: "l", name: "Litre", type: "VOLUME", base: "ml", factor: 1000, precision: 3 },
  { code: "pc", name: "Piece", type: "COUNT", precision: 0 },
  { code: "dz", name: "Dozen", type: "COUNT", base: "pc", factor: 12, precision: 2 },
];

export async function createStandardUnits() {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.unitOfMeasure.findMany({ select: { id: true, code: true, type: true, baseUnitId: true } });
    const byCode = new Map(existing.map((unit) => [unit.code, unit]));
    const created = [];

    for (const unit of STANDARD_UNITS) {
      if (byCode.has(unit.code)) continue;

      const base = unit.base ? byCode.get(unit.base) : null;
      // A same-named base the owner redefined (a "g" that is not a base
      // weight) cannot anchor the conversion, so the derived unit is skipped
      // rather than wired to it.
      if (unit.base && (!base || base.type !== unit.type || base.baseUnitId)) continue;

      const row = await tx.unitOfMeasure.create({
        data: {
          code: unit.code,
          name: unit.name,
          type: unit.type,
          precision: unit.precision,
          baseUnitId: base?.id ?? null,
          factor: base ? unit.factor : 1,
        },
        select: { id: true, code: true, type: true, baseUnitId: true },
      });
      byCode.set(row.code, row);
      created.push(row.code);
    }

    return { created, skipped: STANDARD_UNITS.length - created.length };
  });
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
      baseUnitId: true,
      _count: { select: { stockMovements: true, items: true, recipeIngredients: true, derived: true } },
    },
  });
  if (!unit) throw ApiError.notFound("Unit not found");

  const inUse =
    unit._count.stockMovements > 0 ||
    unit._count.items > 0 ||
    unit._count.recipeIngredients > 0 ||
    // A base unit with units converting into it: changing its type would
    // leave "1 kg = 1000 g" pointing at something that is no longer a weight.
    unit._count.derived > 0;
  // Compared as decimals. This used to compare strings with `startsWith`,
  // which read a change from 1 to 10 — or 100 to 1000 — as "unchanged".
  const changesConversion =
    (data.factor !== undefined && !new Prisma.Decimal(data.factor).equals(new Prisma.Decimal(unit.factor))) ||
    (data.baseUnitId !== undefined && data.baseUnitId !== unit.baseUnitId) ||
    (data.type !== undefined && data.type !== unit.type);

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

  // Becoming a base unit resets the factor to what a base unit means.
  const next = data.baseUnitId === null ? { ...data, factor: 1 } : data;
  return prisma.unitOfMeasure.update({ where: { id }, data: next, select: SELECT });
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

export async function createInventoryCategory(input) {
  // A blank code is no code; stored as "" it would collide with the next blank one.
  const data = { ...input, ...(input.code !== undefined ? { code: input.code?.trim() || null } : {}) };
  const clash = await prisma.inventoryCategory.findFirst({
    where: { name: { equals: data.name, mode: "insensitive" } },
    select: { id: true },
  });
  if (clash) throw ApiError.conflict(`A category called "${data.name}" already exists`);
  if (data.code) {
    const codeClash = await prisma.inventoryCategory.findFirst({ where: { code: data.code }, select: { id: true } });
    if (codeClash) throw ApiError.conflict(`Another category already uses the code "${data.code}"`);
  }

  return prisma.inventoryCategory.create({ data, select: CATEGORY_SELECT });
}

export async function updateInventoryCategory(id, input) {
  const data = { ...input, ...(input.code !== undefined ? { code: input.code?.trim() || null } : {}) };
  const category = await prisma.inventoryCategory.findUnique({ where: { id }, select: { id: true } });
  if (!category) throw ApiError.notFound("Category not found");

  if (data.name) {
    const clash = await prisma.inventoryCategory.findFirst({
      where: { name: { equals: data.name, mode: "insensitive" }, id: { not: id } },
      select: { id: true },
    });
    if (clash) throw ApiError.conflict(`A category called "${data.name}" already exists`);
  }
  if (data.code) {
    const clash = await prisma.inventoryCategory.findFirst({ where: { code: data.code, id: { not: id } }, select: { id: true } });
    if (clash) throw ApiError.conflict(`Another category already uses the code "${data.code}"`);
  }

  return prisma.inventoryCategory.update({ where: { id }, data, select: CATEGORY_SELECT });
}

/** Deleting a category only unassigns its items — it never removes stock. */
export async function deleteInventoryCategory(id) {
  const category = await prisma.inventoryCategory.findUnique({ where: { id }, select: { id: true } });
  if (!category) throw ApiError.notFound("Category not found");

  await prisma.inventoryCategory.delete({ where: { id } });
  return { deleted: true, id };
}
