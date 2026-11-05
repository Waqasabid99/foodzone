import { prisma } from "@/lib/prisma";
import { branchScope, can } from "@/lib/api/permissions";
import { branchFilter } from "@/server/access/scope";
import { scopedBranches } from "@/server/content/branch-scope";

/**
 * What the Purchasing screens need besides the documents themselves: the
 * pickers, the counts on the tabs, and the names behind the ids.
 *
 * Suppliers are offered company-wide, because they are company data — one
 * company negotiates one price list. Everything the supplier *costs* is cut to
 * the viewer's branches, because a purchase order, a delivery and a payable
 * each belong to one outlet.
 */

export { scopedBranches };

/** Branches the viewer may actually raise a document for, not merely read. */
export async function actionableBranches(principal, permissionKey) {
  const branches = await scopedBranches(principal, permissionKey);
  return branches.filter((branch) => branch.isActive && can(principal, permissionKey, { branchId: branch.id }));
}

/** Active suppliers for a picker, with the terms that decide a due date. */
export async function supplierOptions({ includeInactive = false } = {}) {
  return prisma.supplier.findMany({
    where: includeInactive ? {} : { isActive: true },
    select: { id: true, name: true, code: true, paymentTermDays: true, isActive: true },
    orderBy: { name: "asc" },
    take: 2000,
  });
}

/**
 * One supplier's agreed prices, keyed by item.
 *
 * The reason a purchase order form is not guesswork: the price box opens on
 * what was agreed rather than on whatever the buyer remembers, and a price
 * that has moved is then visible as a change rather than as a number.
 */
export async function priceList(supplierId) {
  if (!supplierId) return {};
  const rows = await prisma.supplierItem.findMany({
    where: { supplierId },
    select: {
      itemId: true,
      unitPrice: true,
      uomId: true,
      supplierSku: true,
      minOrderQuantity: true,
      leadTimeDays: true,
      lastPurchasedAt: true,
      uom: { select: { id: true, code: true, precision: true } },
    },
  });

  return Object.fromEntries(
    rows.map((row) => [
      row.itemId,
      {
        unitPrice: row.unitPrice.toString(),
        uomId: row.uomId,
        uomCode: row.uom?.code ?? null,
        supplierSku: row.supplierSku,
        minOrderQuantity: row.minOrderQuantity?.toString() ?? null,
        leadTimeDays: row.leadTimeDays,
        lastPurchasedAt: row.lastPurchasedAt,
      },
    ]),
  );
}

/** Which suppliers already carry each item, so a price list can say "also from". */
export async function suppliersByItem(itemIds) {
  if (!itemIds.length) return {};
  const rows = await prisma.supplierItem.findMany({
    where: { itemId: { in: itemIds } },
    select: { itemId: true, isPreferred: true, supplier: { select: { id: true, name: true } } },
  });

  const grouped = {};
  for (const row of rows) {
    (grouped[row.itemId] ??= []).push({ ...row.supplier, isPreferred: row.isPreferred });
  }
  return grouped;
}

/**
 * Orders still expecting a delivery, for the "receive against an order" picker.
 *
 * Scoped, and restricted to the stages where receiving is meaningful: an
 * unapproved order has not been placed, so anything arriving against it is a
 * delivery nobody ordered and should be received without one.
 */
export async function receivableOrders(principal, { branchId = null, supplierId = null } = {}) {
  const filter = branchFilter(branchScope(principal, "purchase_orders.read"));

  return prisma.purchaseOrder.findMany({
    where: {
      status: { in: ["APPROVED", "SENT", "PARTIALLY_RECEIVED"] },
      ...(filter ? { branchId: filter } : {}),
      ...(branchId ? { branchId } : {}),
      ...(supplierId ? { supplierId } : {}),
    },
    select: {
      id: true,
      poNumber: true,
      branchId: true,
      supplierId: true,
      status: true,
      expectedAt: true,
      supplier: { select: { id: true, name: true } },
    },
    orderBy: { orderDate: "desc" },
    take: 200,
  });
}

/** One order's lines, in the shape the receiving form wants them. */
export async function orderForReceiving(purchaseOrderId) {
  if (!purchaseOrderId) return null;

  const order = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: {
      id: true,
      poNumber: true,
      branchId: true,
      supplierId: true,
      status: true,
      currency: true,
      supplier: { select: { id: true, name: true } },
      items: {
        select: {
          id: true,
          itemId: true,
          quantity: true,
          receivedQuantity: true,
          unitPrice: true,
          taxRate: true,
          uomId: true,
          uom: { select: { id: true, code: true, precision: true } },
          item: {
            select: {
              id: true,
              name: true,
              sku: true,
              trackBatches: true,
              isPerishable: true,
              shelfLifeDays: true,
              uom: { select: { id: true, code: true, precision: true } },
            },
          },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!order) return null;

  return {
    ...order,
    items: order.items.map((line) => ({
      ...line,
      outstanding: line.quantity.minus(line.receivedQuantity).toString(),
    })),
  };
}

/**
 * Deliveries that have been posted but never invoiced.
 *
 * This list is the one that costs money when nobody looks at it: stock is on
 * the books and sitting in "goods received not invoiced", and until the bill
 * lands the restaurant cannot tell whether it was charged what it agreed.
 */
export async function unbilledReceipts(principal, { supplierId = null, limit = 50 } = {}) {
  const filter = branchFilter(branchScope(principal, "supplier_bills.read"));

  return prisma.goodsReceipt.findMany({
    where: {
      status: "COMPLETED",
      bill: { is: null },
      ...(filter ? { branchId: filter } : {}),
      ...(supplierId ? { supplierId } : {}),
    },
    select: {
      id: true,
      grnNumber: true,
      branchId: true,
      receivedAt: true,
      grandTotal: true,
      supplierInvoiceNumber: true,
      supplier: { select: { id: true, name: true } },
      purchaseOrder: { select: { id: true, poNumber: true } },
    },
    orderBy: { receivedAt: "asc" },
    take: limit,
  });
}

/**
 * The bill raised against one delivery, if there is one.
 *
 * Scoped the same way the bills list is: a receipt a viewer may open does not
 * entitle them to the payable it became, which belongs to the finance side.
 */
export async function billForReceipt(principal, goodsReceiptId) {
  if (!can(principal, "supplier_bills.read")) return null;
  const filter = branchFilter(branchScope(principal, "supplier_bills.read"));

  return prisma.supplierBill.findFirst({
    where: { goodsReceiptId, ...(filter ? { branchId: filter } : {}) },
    select: { id: true, billNumber: true, status: true, grandTotal: true, paidAmount: true, currency: true },
  });
}

/** Cash and bank accounts a payment may come out of. */
export async function paymentAccounts() {
  return prisma.account.findMany({
    where: { isActive: true, type: "ASSET" },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
    take: 500,
  });
}

/** How many documents sit at each stage, for the tabs over a list. */
export async function purchaseOrderCounts(principal, { branchId = null } = {}) {
  const filter = branchFilter(branchScope(principal, "purchase_orders.read"));
  const rows = await prisma.purchaseOrder.groupBy({
    by: ["status"],
    where: { ...(filter ? { branchId: filter } : {}), ...(branchId ? { branchId } : {}) },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
}

export async function billCounts(principal, { branchId = null } = {}) {
  const filter = branchFilter(branchScope(principal, "supplier_bills.read"));
  const rows = await prisma.supplierBill.groupBy({
    by: ["status"],
    where: { ...(filter ? { branchId: filter } : {}), ...(branchId ? { branchId } : {}) },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
}

export async function goodsReceiptCounts(principal, { branchId = null } = {}) {
  const filter = branchFilter(branchScope(principal, "goods_receipts.read"));
  const rows = await prisma.goodsReceipt.groupBy({
    by: ["status"],
    where: { ...(filter ? { branchId: filter } : {}), ...(branchId ? { branchId } : {}) },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
}

/** Recent documents for one supplier's page, so their profile shows the trade. */
export async function supplierActivity(principal, supplierId, { take = 8 } = {}) {
  const orderFilter = branchFilter(branchScope(principal, "purchase_orders.read"));
  const billFilter = branchFilter(branchScope(principal, "supplier_bills.read"));

  const [orders, bills] = await Promise.all([
    can(principal, "purchase_orders.read")
      ? prisma.purchaseOrder.findMany({
          where: { supplierId, ...(orderFilter ? { branchId: orderFilter } : {}) },
          select: { id: true, poNumber: true, status: true, orderDate: true, grandTotal: true, currency: true },
          orderBy: { orderDate: "desc" },
          take,
        })
      : [],
    can(principal, "supplier_bills.read")
      ? prisma.supplierBill.findMany({
          where: { supplierId, ...(billFilter ? { branchId: billFilter } : {}) },
          select: {
            id: true,
            billNumber: true,
            status: true,
            billDate: true,
            dueDate: true,
            grandTotal: true,
            paidAmount: true,
            currency: true,
          },
          orderBy: { billDate: "desc" },
          take,
        })
      : [],
  ]);

  return { orders, bills };
}

/** Display names for the `createdById` / `approvedById` columns these documents carry. */
export async function userNames(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return Object.fromEntries(users.map((user) => [user.id, user.name]));
}
