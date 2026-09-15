import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { unitCost } from "@/server/inventory/uom";

/**
 * Suppliers and their price lists.
 *
 * A `SupplierItem` is what one supplier charges for one item in one unit, and
 * it is the reason purchasing is not guesswork: a purchase order line can be
 * priced from the agreed list rather than from whatever someone remembers.
 *
 * `isPreferred` picks the default supplier per item — one per item, enforced by
 * clearing the others, because "preferred" that applies to three suppliers
 * means nothing.
 */

const SELECT = {
  id: true,
  code: true,
  name: true,
  contactPerson: true,
  email: true,
  phone: true,
  addressLine1: true,
  city: true,
  state: true,
  country: true,
  postalCode: true,
  taxIdentifier: true,
  paymentTermDays: true,
  creditLimit: true,
  accountId: true,
  rating: true,
  notes: true,
  isActive: true,
  createdAt: true,
};

export async function listSuppliers({ search, isActive, limit = 20, cursor } = {}) {
  const rows = await prisma.supplier.findMany({
    where: {
      ...(isActive !== undefined ? { isActive } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { code: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: { ...SELECT, _count: { select: { items: true, purchaseOrders: true } } },
    orderBy: { name: "asc" },
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);
  return {
    ...page,
    items: page.items.map(({ _count, ...row }) => ({
      ...row,
      itemCount: _count.items,
      purchaseOrderCount: _count.purchaseOrders,
    })),
  };
}

export async function getSupplier(id) {
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    select: {
      ...SELECT,
      items: {
        select: {
          id: true,
          supplierSku: true,
          unitPrice: true,
          minOrderQuantity: true,
          leadTimeDays: true,
          isPreferred: true,
          lastPurchasedAt: true,
          item: { select: { id: true, sku: true, name: true } },
          uom: { select: { id: true, code: true } },
        },
        orderBy: { item: { name: "asc" } },
      },
    },
  });
  if (!supplier) throw ApiError.notFound("Supplier not found");
  return supplier;
}

export async function createSupplier(data) {
  const code = data.code.trim().toUpperCase();
  const clash = await prisma.supplier.findUnique({ where: { code }, select: { id: true } });
  if (clash) throw ApiError.conflict(`A supplier with code "${code}" already exists`);

  return prisma.supplier.create({ data: { ...data, code }, select: SELECT });
}

export async function updateSupplier(id, data) {
  const supplier = await prisma.supplier.findUnique({ where: { id }, select: { id: true } });
  if (!supplier) throw ApiError.notFound("Supplier not found");

  if (data.code) {
    const code = data.code.trim().toUpperCase();
    const clash = await prisma.supplier.findFirst({ where: { code, id: { not: id } }, select: { id: true } });
    if (clash) throw ApiError.conflict(`A supplier with code "${code}" already exists`);
    data = { ...data, code };
  }

  return prisma.supplier.update({ where: { id }, data, select: SELECT });
}

/**
 * A supplier with purchase history is deactivated, never deleted.
 *
 * Purchase orders and goods receipts point at them, and a receipt that cannot
 * name who delivered the food is useless in a recall.
 */
export async function deleteSupplier(id) {
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    select: { id: true, _count: { select: { purchaseOrders: true, goodsReceipts: true } } },
  });
  if (!supplier) throw ApiError.notFound("Supplier not found");

  if (supplier._count.purchaseOrders > 0 || supplier._count.goodsReceipts > 0) {
    throw ApiError.conflict("This supplier has purchase history. Deactivate them instead of deleting them.", {
      purchaseOrders: supplier._count.purchaseOrders,
      goodsReceipts: supplier._count.goodsReceipts,
    });
  }

  await prisma.supplier.delete({ where: { id } });
  return { deleted: true, id };
}

// --- price lists ------------------------------------------------------------

/**
 * Adds or updates what a supplier charges for an item.
 *
 * Upsert rather than create: a price list is a living document, and re-sending
 * a line after a price rise is the normal case, not a conflict.
 */
export async function setSupplierItem({ supplierId, itemId, ...data }) {
  const [supplier, item, uom] = await Promise.all([
    prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true } }),
    prisma.inventoryItem.findUnique({ where: { id: itemId }, select: { id: true, uomId: true } }),
    data.uomId
      ? prisma.unitOfMeasure.findUnique({ where: { id: data.uomId }, select: { id: true } })
      : Promise.resolve(null),
  ]);

  if (!supplier) throw ApiError.validation("Supplier not found", { supplierId: ["No such supplier"] });
  if (!item) throw ApiError.validation("Item not found", { itemId: ["No such item"] });
  if (data.uomId && !uom) throw ApiError.validation("Unit not found", { uomId: ["No such unit"] });

  const uomId = data.uomId ?? item.uomId;

  return prisma.$transaction(async (tx) => {
    if (data.isPreferred) {
      // One preferred supplier per item.
      await tx.supplierItem.updateMany({ where: { itemId }, data: { isPreferred: false } });
    }

    return tx.supplierItem.upsert({
      where: { supplierId_itemId: { supplierId, itemId } },
      create: { supplierId, itemId, ...data, uomId, unitPrice: unitCost(data.unitPrice) },
      update: { ...data, uomId, unitPrice: unitCost(data.unitPrice) },
      select: {
        id: true,
        supplierId: true,
        itemId: true,
        supplierSku: true,
        uomId: true,
        unitPrice: true,
        minOrderQuantity: true,
        leadTimeDays: true,
        isPreferred: true,
      },
    });
  });
}

export async function removeSupplierItem({ supplierId, itemId }) {
  const row = await prisma.supplierItem.findUnique({
    where: { supplierId_itemId: { supplierId, itemId } },
    select: { id: true },
  });
  if (!row) throw ApiError.notFound("That item is not on this supplier's price list");

  await prisma.supplierItem.delete({ where: { id: row.id } });
  return { deleted: true, supplierId, itemId };
}

/** Who to buy an item from, and at what price. */
export async function suppliersForItem(itemId) {
  return prisma.supplierItem.findMany({
    where: { itemId, supplier: { isActive: true } },
    select: {
      id: true,
      unitPrice: true,
      minOrderQuantity: true,
      leadTimeDays: true,
      isPreferred: true,
      supplierSku: true,
      lastPurchasedAt: true,
      supplier: { select: { id: true, code: true, name: true, paymentTermDays: true } },
      uom: { select: { id: true, code: true } },
    },
    orderBy: [{ isPreferred: "desc" }, { unitPrice: "asc" }],
  });
}
