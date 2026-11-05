import { prisma } from "@/lib/prisma";
import { branchScope, can } from "@/lib/api/permissions";
import { branchFilter } from "@/server/access/scope";
import { scopedBranches } from "@/server/content/branch-scope";

/**
 * What the Delivery screens need besides the records themselves: the pickers,
 * the counts on the tabs, and the accounts a driver can be created from.
 *
 * Every list is cut to the viewer's branches. A dispatcher at one outlet
 * offering a job to a driver at another is a form that fails on submit — and
 * a quieter way of telling them how many riders the other branch has.
 */

export { scopedBranches };

export async function actionableBranches(principal, permissionKey) {
  const branches = await scopedBranches(principal, permissionKey);
  return branches.filter((branch) => branch.isActive && can(principal, permissionKey, { branchId: branch.id }));
}

/** How many deliveries sit at each status, for the tabs over the list. */
export async function deliveryCounts(principal, { branchId = null } = {}) {
  const filter = branchFilter(branchScope(principal, "deliveries.read"));
  const rows = await prisma.delivery.groupBy({
    by: ["status"],
    where: {
      ...(filter ? { order: { branchId: filter } } : {}),
      ...(branchId ? { order: { branchId } } : {}),
    },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
}

/**
 * Drivers who could be given a job right now, at one branch.
 *
 * Includes the ones already carrying something: a rider with one drop left who
 * is heading that way is often the right answer, and hiding them would make
 * the board say "no drivers" during exactly the rush it exists for. Whether
 * each has room is the screen's judgement to show, not this query's to make.
 */
export async function assignableDrivers(principal, branchId) {
  if (!branchId || !can(principal, "deliveries.assign", { branchId })) return [];

  const drivers = await prisma.driver.findMany({
    where: { branchId, isActive: true, status: { in: ["AVAILABLE", "ON_DELIVERY"] } },
    select: {
      id: true,
      status: true,
      vehicleType: true,
      maxActiveOrders: true,
      cashInHand: true,
      lastLocationAt: true,
      user: { select: { id: true, name: true, phone: true } },
      _count: { select: { deliveries: { where: { status: { in: ["ASSIGNED", "ACCEPTED", "ARRIVED_AT_STORE", "PICKED_UP", "ON_THE_WAY", "ARRIVED"] } } } } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    take: 200,
  });

  return drivers.map(({ _count, ...driver }) => ({ ...driver, activeDeliveries: _count.deliveries }));
}

/**
 * Sign-in accounts that are not already a driver.
 *
 * A driver has to be able to open the driver app, so the record is built on
 * top of an account rather than inventing a second identity for the same
 * person — the same rule the employee screens follow.
 */
export async function linkableAccounts({ search = null, take = 20 } = {}) {
  const text = String(search ?? "").trim();

  return prisma.user.findMany({
    where: {
      deletedAt: null,
      driver: null,
      ...(text
        ? {
            OR: [
              { name: { contains: text, mode: "insensitive" } },
              { email: { contains: text, mode: "insensitive" } },
              { phone: { contains: text, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: { id: true, name: true, email: true, phone: true },
    orderBy: { name: "asc" },
    take,
  });
}

/** Drivers a payout run can cover, for the generate form. */
export async function payableDrivers(principal) {
  const filter = branchFilter(branchScope(principal, "driver_payouts.read"));
  return prisma.driver.findMany({
    where: { isActive: true, ...(filter ? { branchId: filter } : {}) },
    select: {
      id: true,
      branchId: true,
      cashInHand: true,
      user: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
}

export async function payoutCounts(principal) {
  const filter = branchFilter(branchScope(principal, "driver_payouts.read"));
  const rows = await prisma.driverPayout.groupBy({
    by: ["status"],
    where: filter ? { driver: { branchId: filter } } : {},
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
}

/**
 * Cash the company is carrying around in drivers' bags.
 *
 * The number worth putting on a screen: COD collected is the restaurant's
 * money in somebody's pocket until the end of a shift, and nobody notices it
 * growing unless it is counted somewhere.
 */
export async function cashOnTheRoad(principal, { branchId = null } = {}) {
  const filter = branchFilter(branchScope(principal, "drivers.read"));
  const rows = await prisma.driver.findMany({
    where: {
      isActive: true,
      cashInHand: { gt: 0 },
      ...(filter ? { branchId: filter } : {}),
      ...(branchId ? { branchId } : {}),
    },
    select: { id: true, cashInHand: true, user: { select: { name: true } } },
    orderBy: { cashInHand: "desc" },
    take: 50,
  });

  return {
    drivers: rows,
    total: rows.reduce((sum, row) => sum + Number(row.cashInHand), 0),
  };
}

/** Display names for the loose actor columns these records carry. */
export async function userNames(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return Object.fromEntries(users.map((user) => [user.id, user.name]));
}
