import { prisma } from "@/lib/prisma";
import { ApiError, assertBranchAccess } from "@/lib/api";
import { branchScope, can } from "@/lib/api/permissions";
import { branchFilter, inScope, intersectScopes, recordAccess, reaches, scopeWhere } from "@/server/access/scope";

export { branchFilter, inScope, intersectScopes, reaches, scopeWhere };

/**
 * Which branch a service record belongs to, and whether the caller may open it.
 *
 * Service is where branch scoping matters most and is hardest to see missing.
 * An order carries a customer's name, their phone number and what they spent;
 * a cart carries what somebody is shopping for right now. A cashier holds
 * `orders.read` at the till they work at — that grant answers "may they see
 * orders?", not "whose?". Without the list half of it, omitting the branch
 * filter hands them every outlet's customers.
 *
 * `orders.read_all_branches` exists precisely as the opt-in for the regional
 * manager who genuinely needs the lot. Its existence is what makes the
 * unfiltered default a bug rather than a design: the catalogue already says
 * who is allowed to cross the wall.
 *
 * A cart with no branch is a shopper who has not picked an outlet yet. It
 * belongs to nobody, so it is shown to anyone who may read carts at all —
 * hiding it would mean nobody could ever help them.
 */

const LOOKUPS = {
  order: (id) => prisma.order.findUnique({ where: { id }, select: { branchId: true } }).then((row) => row && [row.branchId]),
  table: (id) =>
    prisma.restaurantTable.findUnique({ where: { id }, select: { branchId: true } }).then((row) => row && [row.branchId]),
  qrCode: (id) => prisma.qrCode.findUnique({ where: { id }, select: { branchId: true } }).then((row) => row && [row.branchId]),
  cart: (id) => prisma.cart.findUnique({ where: { id }, select: { branchId: true } }).then((row) => row && [row.branchId]),
};

const NOT_FOUND = {
  order: "Order not found",
  table: "Table not found",
  qrCode: "QR code not found",
  cart: "Cart not found",
};

export const { recordBranches, assertRecordAccess } = recordAccess(LOOKUPS, NOT_FOUND);

/**
 * The branches whose orders this caller may see.
 *
 * `orders.read_all_branches` lifts the restriction entirely rather than
 * widening it branch by branch, which is what "all branches" has to mean for a
 * regional role whose outlets change without their grants being rewritten.
 */
export function orderScope(principal, permissionKey = "orders.read") {
  if (can(principal, "orders.read_all_branches")) return { all: true, except: [] };
  return branchScope(principal, permissionKey);
}

/**
 * Whether the caller may open one order.
 *
 * Not the generic `assertRecordAccess`, because orders have the
 * `read_all_branches` bypass and the generic helper knows nothing about it.
 * Out of scope answers not-found rather than forbidden: that an order exists
 * at another outlet — with a real customer behind it — is itself something a
 * till operator has no business confirming by guessing an id.
 */
export async function assertOrderAccess(principal, orderId, permissionKey) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { branchId: true } });
  if (!order) throw ApiError.notFound(NOT_FOUND.order);

  const scope = permissionKey === "orders.read" ? orderScope(principal, permissionKey) : branchScope(principal, permissionKey);
  if (!inScope(scope, order.branchId)) throw ApiError.notFound(NOT_FOUND.order);

  if (!can(principal, "orders.read_all_branches") || permissionKey !== "orders.read") {
    assertBranchAccess(principal, order.branchId, permissionKey);
  }
  return order.branchId;
}
