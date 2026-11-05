import { prisma } from "@/lib/prisma";
import { branchFilter, inScope, intersectScopes, recordAccess, reaches, scopeWhere } from "@/server/access/scope";

export { branchFilter, inScope, intersectScopes, reaches, scopeWhere };

/**
 * Which branch a delivery record belongs to, and whether the caller may open
 * it.
 *
 * This is the most exposed data in the system. A delivery carries the
 * customer's **home address** and their phone number; a driver record carries
 * a person's licence and vehicle; a payout carries their pay. A dispatcher
 * holds `deliveries.read` at the outlet they dispatch for — that grant answers
 * "may they see deliveries?", not "whose?" — so without the list half of it,
 * omitting the branch filter hands over every customer's address in the
 * company.
 *
 * None of the three tables carries a branch directly in the same way:
 *
 *   * a **delivery** belongs to the branch of its order;
 *   * a **driver** has a branch of their own;
 *   * a **payout** belongs to the branch of its driver.
 *
 * Each is resolved through its own path rather than assumed, because guessing
 * `branchId` on a table that does not have one fails open — the filter
 * silently matches nothing and the scope is never applied.
 */

const LOOKUPS = {
  delivery: (id) =>
    prisma.delivery
      .findUnique({ where: { id }, select: { order: { select: { branchId: true } } } })
      .then((row) => row && [row.order.branchId]),
  driver: (id) => prisma.driver.findUnique({ where: { id }, select: { branchId: true } }).then((row) => row && [row.branchId]),
  driverPayout: (id) =>
    prisma.driverPayout
      .findUnique({ where: { id }, select: { driver: { select: { branchId: true } } } })
      .then((row) => row && [row.driver.branchId]),
};

const NOT_FOUND = {
  delivery: "Delivery not found",
  driver: "Driver not found",
  driverPayout: "Payout not found",
};

export const { recordBranches, assertRecordAccess } = recordAccess(LOOKUPS, NOT_FOUND);
