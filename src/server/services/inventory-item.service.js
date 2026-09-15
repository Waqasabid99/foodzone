import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { slugify } from "@/lib/slug";

/**
 * Inventory items — the things a restaurant physically holds.
 *
 * Distinct from catalog `Product`s, and deliberately so: a product is what a
 * customer buys, an item is what sits on a shelf. One burger consumes a bun, a
 * patty, and 30g of cheese; none of those are products, and the cheese is used
 * by nine other dishes. Collapsing the two is the modelling mistake that makes
 * a restaurant system unable to answer what anything actually costs.
 *
 * Items are **soft-deleted by deactivation**, never removed: the stock ledger
 * references them forever, and history that cannot name what moved is not
 * history.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const SELECT = {
  id: true,
  sku: true,
  name: true,
  description: true,
  type: true,
  categoryId: true,
  uomId: true,
  barcode: true,
  imageUrl: true,
  costingMethod: true,
  averageCost: true,
  lastPurchaseCost: true,
  isPerishable: true,
  trackBatches: true,
  shelfLifeDays: true,
  reorderLevel: true,
  reorderQuantity: true,
  yieldPercent: true,
  taxGroupId: true,
  isActive: true,
  createdAt: true,
  category: { select: { id: true, name: true } },
  uom: { select: { id: true, code: true, name: true, type: true, precision: true } },
};

export async function listItems({ search, type, categoryId, isActive, lowStock, branchId, limit = 20, cursor } = {}) {
  const rows = await prisma.inventoryItem.findMany({
    where: {
      ...(type ? { type } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { sku: { contains: search, mode: "insensitive" } },
              { barcode: search },
            ],
          }
        : {}),
    },
    select: {
      ...SELECT,
      stockLevels: {
        where: branchId ? { location: { branchId } } : {},
        select: { quantity: true, reservedQuantity: true, locationId: true },
      },
    },
    orderBy: { name: "asc" },
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);

  const items = page.items.map(({ stockLevels, ...item }) => {
    const onHand = stockLevels.reduce((total, level) => total.plus(D(level.quantity)), D(0));
    return {
      ...item,
      onHand,
      // Answered here rather than filtered in SQL, because "low" is a
      // comparison between two columns across a join.
      isLow: item.reorderLevel != null && onHand.lessThanOrEqualTo(D(item.reorderLevel)),
    };
  });

  return { ...page, items: lowStock ? items.filter((item) => item.isLow) : items };
}

export async function getItem(id) {
  const item = await prisma.inventoryItem.findUnique({
    where: { id },
    select: {
      ...SELECT,
      stockLevels: {
        select: {
          quantity: true,
          reservedQuantity: true,
          location: { select: { id: true, name: true, code: true, branchId: true } },
        },
      },
      batches: {
        where: { status: "ACTIVE" },
        select: {
          id: true,
          batchNumber: true,
          remainingQuantity: true,
          unitCost: true,
          expiryDate: true,
          locationId: true,
        },
        orderBy: { expiryDate: "asc" },
      },
    },
  });
  if (!item) throw ApiError.notFound("Inventory item not found");

  const onHand = item.stockLevels.reduce((total, level) => total.plus(D(level.quantity)), D(0));
  return { ...item, onHand, stockValue: onHand.times(D(item.averageCost)) };
}

async function assertReferencesExist({ uomId, categoryId, taxGroupId }) {
  if (uomId) {
    const uom = await prisma.unitOfMeasure.findUnique({ where: { id: uomId }, select: { id: true, isActive: true } });
    if (!uom) throw ApiError.validation("Unit not found", { uomId: ["No such unit"] });
  }
  if (categoryId) {
    const category = await prisma.inventoryCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!category) throw ApiError.validation("Category not found", { categoryId: ["No such category"] });
  }
  if (taxGroupId) {
    const group = await prisma.taxGroup.findUnique({ where: { id: taxGroupId }, select: { id: true } });
    if (!group) throw ApiError.validation("Tax group not found", { taxGroupId: ["No such tax group"] });
  }
}

async function generateSku(name) {
  const base = slugify(name).toUpperCase().replace(/-/g, "").slice(0, 10) || "ITEM";

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}${attempt}`;
    const clash = await prisma.inventoryItem.findUnique({ where: { sku: candidate }, select: { id: true } });
    if (!clash) return candidate;
  }

  return `${base}${Date.now().toString(36).toUpperCase().slice(-5)}`;
}

/**
 * Perishability and batch tracking are related but not the same thing.
 *
 * An item can expire without being lot-tracked (a chef checks the date on the
 * carton), and can be lot-tracked without expiring (a supplier recall needs to
 * name which delivery). Only the combination "expires but has no shelf life and
 * no batches" is incoherent, because nothing would ever know it had gone off.
 */
function assertPerishabilityIsCoherent(data) {
  if (data.isPerishable && !data.trackBatches && data.shelfLifeDays == null) {
    throw ApiError.validation("A perishable item needs either a shelf life or batch tracking", {
      shelfLifeDays: ["Set a shelf life, or turn on batch tracking to capture expiry per delivery"],
    });
  }
}

export async function createItem(data, actor = null) {
  await assertReferencesExist(data);
  assertPerishabilityIsCoherent(data);

  const sku = data.sku?.trim() || (await generateSku(data.name));

  const clash = await prisma.inventoryItem.findUnique({ where: { sku }, select: { id: true } });
  if (clash) throw ApiError.conflict(`An item with SKU "${sku}" already exists`);

  return prisma.inventoryItem.create({
    data: { ...data, sku, createdById: actor?.userId ?? null },
    select: SELECT,
  });
}

export async function updateItem(id, data) {
  const existing = await prisma.inventoryItem.findUnique({
    where: { id },
    select: { id: true, isPerishable: true, trackBatches: true, shelfLifeDays: true },
  });
  if (!existing) throw ApiError.notFound("Inventory item not found");

  await assertReferencesExist(data);
  assertPerishabilityIsCoherent({ ...existing, ...data });

  if (data.sku) {
    const clash = await prisma.inventoryItem.findFirst({
      where: { sku: data.sku.trim(), id: { not: id } },
      select: { id: true },
    });
    if (clash) throw ApiError.conflict(`An item with SKU "${data.sku}" already exists`);
  }

  // Changing the stocking unit would reinterpret every quantity already on the
  // ledger: 5 becomes 5 of something else.
  if (data.uomId) {
    const movements = await prisma.stockMovement.count({ where: { itemId: id } });
    if (movements > 0) {
      throw ApiError.conflict(
        "This item already has stock history, so its stocking unit cannot change — every past quantity was recorded in the old unit.",
        { movements },
      );
    }
  }

  return prisma.inventoryItem.update({ where: { id }, data, select: SELECT });
}

/**
 * Deactivates rather than deletes.
 *
 * An item with stock on hand cannot even be deactivated: hiding something that
 * physically exists is how a store room ends up with food nobody is counting.
 */
export async function deactivateItem(id) {
  const item = await prisma.inventoryItem.findUnique({
    where: { id },
    select: { id: true, name: true, stockLevels: { select: { quantity: true } } },
  });
  if (!item) throw ApiError.notFound("Inventory item not found");

  const onHand = item.stockLevels.reduce((total, level) => total.plus(D(level.quantity)), D(0));
  if (onHand.greaterThan(0)) {
    throw ApiError.conflict(
      `There is still ${onHand} of ${item.name} in stock. Write it off or transfer it before deactivating.`,
      { onHand: Number(onHand) },
    );
  }

  return prisma.inventoryItem.update({ where: { id }, data: { isActive: false }, select: SELECT });
}

// --- stock locations --------------------------------------------------------

const LOCATION_SELECT = {
  id: true,
  branchId: true,
  name: true,
  code: true,
  type: true,
  isDefault: true,
  isActive: true,
};

export async function listLocations({ branchId, isActive } = {}) {
  return prisma.stockLocation.findMany({
    where: { ...(branchId ? { branchId } : {}), ...(isActive !== undefined ? { isActive } : {}) },
    select: { ...LOCATION_SELECT, _count: { select: { levels: true } } },
    orderBy: [{ branchId: "asc" }, { name: "asc" }],
  });
}

export async function getLocation(id) {
  const location = await prisma.stockLocation.findUnique({ where: { id }, select: LOCATION_SELECT });
  if (!location) throw ApiError.notFound("Stock location not found");
  return location;
}

/**
 * One default location per branch — where sales are deducted from.
 *
 * Enforced by clearing the others rather than refusing, because "make this the
 * default" is unambiguous and making the user unset the old one first is busy
 * work.
 */
export async function createLocation(data) {
  const branch = await prisma.branch.findUnique({ where: { id: data.branchId }, select: { id: true } });
  if (!branch) throw ApiError.validation("Branch not found", { branchId: ["No such branch"] });

  const clash = await prisma.stockLocation.findFirst({
    where: { branchId: data.branchId, code: data.code },
    select: { id: true },
  });
  if (clash) throw ApiError.conflict(`This branch already has a location with code "${data.code}"`);

  return prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.stockLocation.updateMany({ where: { branchId: data.branchId }, data: { isDefault: false } });
    }
    return tx.stockLocation.create({ data, select: LOCATION_SELECT });
  });
}

export async function updateLocation(id, data) {
  const location = await getLocation(id);

  if (data.code) {
    const clash = await prisma.stockLocation.findFirst({
      where: { branchId: location.branchId, code: data.code, id: { not: id } },
      select: { id: true },
    });
    if (clash) throw ApiError.conflict(`This branch already has a location with code "${data.code}"`);
  }

  return prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.stockLocation.updateMany({
        where: { branchId: location.branchId, id: { not: id } },
        data: { isDefault: false },
      });
    }
    return tx.stockLocation.update({ where: { id }, data, select: LOCATION_SELECT });
  });
}

/** The location sales come out of, for a branch. */
export async function defaultLocationFor(branchId, tx = prisma) {
  return (
    (await tx.stockLocation.findFirst({
      where: { branchId, isDefault: true, isActive: true },
      select: { id: true, name: true },
    })) ??
    tx.stockLocation.findFirst({
      where: { branchId, isActive: true },
      select: { id: true, name: true },
      // No createdAt on the model, so ordering by code keeps the fallback
      // deterministic rather than whatever the planner returns first.
      orderBy: { code: "asc" },
    })
  );
}
