import { prisma } from "@/lib/prisma";
import { ApiError, assertBranchAccess } from "@/lib/api";
import { branchScope, can } from "@/lib/api/permissions";
import { branchFilter, inScope, intersectScopes, reaches, scopeWhere } from "@/server/access/scope";

export { branchFilter, inScope, intersectScopes, scopeWhere };

/**
 * Which branch an inventory record belongs to, and whether the caller may act
 * there.
 *
 * Stock is physical and sits in one outlet. Holding `stock_adjustments.approve`
 * at one branch answers "may they approve adjustments?", not "whose?", so every
 * route that names a record by id asks this before touching it — otherwise a
 * manager at one outlet could post a correction to another's store room by
 * guessing an id. Lists get the other half from `scopeWhere`.
 */

/**
 * Whether a production run's money may be shown.
 *
 * What a batch cost is the same secret a recipe's cost is — a porter who can
 * start a run of dough has no need of the margin in it. Visible to whoever may
 * see recipe costs, or the stock's value at that branch.
 */
export function productionCostVisible(principal, branchId) {
  return can(principal, "recipes.view_cost") || can(principal, "stock.view_valuation", { branchId });
}

/** The branches whose production costs `permissionKey`'s holder may see. */
export function productionCostScope(principal, permissionKey = "production_orders.read") {
  const read = branchScope(principal, permissionKey);
  if (can(principal, "recipes.view_cost")) return read;
  return intersectScopes(read, branchScope(principal, "stock.view_valuation"));
}

const LOOKUPS = {
  location: (id) =>
    prisma.stockLocation.findUnique({ where: { id }, select: { branchId: true } }).then((row) => row && [row.branchId]),
  adjustment: (id) =>
    prisma.stockAdjustment
      .findUnique({ where: { id }, select: { location: { select: { branchId: true } } } })
      .then((row) => row && [row.location.branchId]),
  count: (id) => prisma.stockCount.findUnique({ where: { id }, select: { branchId: true } }).then((row) => row && [row.branchId]),
  wastage: (id) =>
    prisma.wastage
      .findUnique({ where: { id }, select: { location: { select: { branchId: true } } } })
      .then((row) => row && [row.location.branchId]),
  batch: (id) =>
    prisma.stockBatch
      .findUnique({ where: { id }, select: { location: { select: { branchId: true } } } })
      .then((row) => row && [row.location.branchId]),
  production: (id) =>
    prisma.productionOrder.findUnique({ where: { id }, select: { branchId: true } }).then((row) => row && [row.branchId]),
  transfer: (id) =>
    prisma.stockTransfer
      .findUnique({
        where: { id },
        select: { fromLocation: { select: { branchId: true } }, toLocation: { select: { branchId: true } } },
      })
      .then((row) => row && [row.fromLocation.branchId, row.toLocation.branchId]),
};

const NOT_FOUND = {
  location: "Stock location not found",
  adjustment: "Adjustment not found",
  count: "Stock count not found",
  wastage: "Wastage record not found",
  batch: "Batch not found",
  transfer: "Transfer not found",
  production: "Production order not found",
};

/** The branch ids a record touches. A transfer touches two. */
export async function recordBranches(kind, id) {
  const branches = await LOOKUPS[kind](id);
  if (!branches) throw ApiError.notFound(NOT_FOUND[kind]);
  return branches;
}

/**
 * Throws unless the caller holds `permissionKey` at the record's branch.
 *
 * A record at a branch the caller has no role at answers 404, not 403: "that
 * adjustment exists at another outlet" is itself information a scoped manager
 * has no business learning. At a branch they do work at, a missing permission
 * is an ordinary 403 the screen can explain.
 */
export async function assertRecordAccess(principal, kind, id, permissionKey) {
  const [branchId] = await recordBranches(kind, id);
  if (!reaches(principal, branchId)) throw ApiError.notFound(NOT_FOUND[kind]);
  assertBranchAccess(principal, branchId, permissionKey);
  return branchId;
}

/** For a transfer: the caller must hold the permission at one particular end of it. */
export async function assertTransferEnd(principal, id, end, permissionKey) {
  const [fromBranchId, toBranchId] = await recordBranches("transfer", id);
  if (!reaches(principal, fromBranchId) && !reaches(principal, toBranchId)) {
    throw ApiError.notFound(NOT_FOUND.transfer);
  }
  assertBranchAccess(principal, end === "from" ? fromBranchId : toBranchId, permissionKey);
  return { fromBranchId, toBranchId };
}

/** For a transfer read: the permission held at either end is enough. */
export async function assertTransferVisible(principal, id, permissionKey) {
  const branches = await recordBranches("transfer", id);
  if (!branches.some((branchId) => reaches(principal, branchId))) throw ApiError.notFound(NOT_FOUND.transfer);
  const allowed = branches.find((branchId) => {
    try {
      assertBranchAccess(principal, branchId, permissionKey);
      return true;
    } catch {
      return false;
    }
  });
  if (!allowed) assertBranchAccess(principal, branches[0], permissionKey);
  return branches;
}
