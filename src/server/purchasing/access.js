import { prisma } from "@/lib/prisma";
import { branchFilter, inScope, intersectScopes, recordAccess, reaches, scopeWhere } from "@/server/access/scope";

export { branchFilter, inScope, intersectScopes, reaches, scopeWhere };

/**
 * Which branch a purchasing document belongs to, and whether the caller may
 * open it.
 *
 * **A supplier is deliberately absent from this file.** Suppliers are company
 * data, not branch data: one company negotiates one price list, and every
 * outlet buys against it. Scoping suppliers per branch would mean a manager
 * could not see who the company buys flour from, which is not a secret and is
 * exactly what they need before raising an order.
 *
 * Everything the supplier *costs*, though, is branch data. A purchase order is
 * a commitment made by one outlet, a goods receipt is stock that arrived at
 * one location, and a bill is one outlet's payable. A purchasing clerk scoped
 * to one branch who omits the branch filter must not be handed the company's
 * whole spend — and with bills, its whole payables position.
 */

const LOOKUPS = {
  purchaseOrder: (id) =>
    prisma.purchaseOrder.findUnique({ where: { id }, select: { branchId: true } }).then((row) => row && [row.branchId]),
  goodsReceipt: (id) =>
    prisma.goodsReceipt.findUnique({ where: { id }, select: { branchId: true } }).then((row) => row && [row.branchId]),
  supplierBill: (id) =>
    prisma.supplierBill.findUnique({ where: { id }, select: { branchId: true } }).then((row) => row && [row.branchId]),
  stockLocation: (id) =>
    prisma.stockLocation.findUnique({ where: { id }, select: { branchId: true } }).then((row) => row && [row.branchId]),
};

const NOT_FOUND = {
  purchaseOrder: "Purchase order not found",
  goodsReceipt: "Goods receipt not found",
  supplierBill: "Supplier bill not found",
  stockLocation: "Stock location not found",
};

export const { recordBranches, assertRecordAccess } = recordAccess(LOOKUPS, NOT_FOUND);
