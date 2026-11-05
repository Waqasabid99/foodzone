import { prisma } from "@/lib/prisma";
import { branchScope, can } from "@/lib/api/permissions";
import { branchFilter } from "@/server/access/scope";
import { scopedBranches } from "@/server/content/branch-scope";
import { orderScope } from "@/server/ordering/access";
import { getOrderMenu } from "@/server/services/menu.service";
import { openSessionFor } from "@/server/services/register.service";

/**
 * What the Service screens need besides the records themselves: the pickers,
 * the counts on the tabs, and the live menu the counter sells from.
 *
 * Every option list is cut to what the viewer may act on. A table picker that
 * offers another branch's dining room is a form that fails on submit, and a
 * quieter way of telling a cashier how many covers the other outlet has.
 */

export { scopedBranches };

/** Branches the viewer may actually serve at, not merely read. */
export async function actionableBranches(principal, permissionKey) {
  const branches = await scopedBranches(principal, permissionKey);
  return branches.filter((branch) => branch.isActive && can(principal, permissionKey, { branchId: branch.id }));
}

/** How many orders sit at each status, for the tabs over the list. */
export async function orderCounts(principal, { branchId = null, since = null } = {}) {
  const filter = branchFilter(orderScope(principal));
  const rows = await prisma.order.groupBy({
    by: ["status"],
    where: {
      ...(filter ? { branchId: filter } : {}),
      ...(branchId ? { branchId } : {}),
      ...(since ? { placedAt: { gte: since } } : {}),
    },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
}

/**
 * The orders a shift is actually working.
 *
 * Everything that has not reached a terminal status, oldest first — the
 * opposite of the main list's newest-first, because the question here is "what
 * has been waiting longest", not "what just came in".
 */
export async function openOrders(principal, { branchId = null, take = 50 } = {}) {
  const filter = branchFilter(orderScope(principal));
  return prisma.order.findMany({
    where: {
      ...(filter ? { branchId: filter } : {}),
      ...(branchId ? { branchId } : {}),
      status: { notIn: ["COMPLETED", "CANCELLED", "REJECTED", "REFUNDED", "DRAFT"] },
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      type: true,
      channel: true,
      placedAt: true,
      grandTotal: true,
      paidTotal: true,
      currency: true,
      branchId: true,
      paymentState: true,
      table: { select: { id: true, name: true } },
    },
    orderBy: [{ placedAt: "asc" }],
    take,
  });
}

/**
 * Which tables have a live order on them right now.
 *
 * Keyed by table id, so a seating chart and the dine-in picker can both answer
 * "is anybody sitting there" without either of them running its own query. A
 * table with no entry is free; the room screen used to show all twenty tables
 * identically whether they were empty or mid-service.
 */
export async function tableOccupancy(principal, branchId) {
  if (!branchId) return {};
  const filter = branchFilter(orderScope(principal));
  const rows = await prisma.order.findMany({
    where: {
      branchId,
      tableId: { not: null },
      ...(filter ? { AND: [{ branchId: filter }] } : {}),
      status: { notIn: ["COMPLETED", "CANCELLED", "REJECTED", "REFUNDED", "DRAFT"] },
    },
    select: { id: true, orderNumber: true, status: true, paymentState: true, placedAt: true, tableId: true },
    orderBy: [{ placedAt: "asc" }],
    take: 500,
  });

  // Oldest first, so where two orders share a table the one still being worked
  // on is the one named.
  const seated = {};
  for (const row of rows) if (!seated[row.tableId]) seated[row.tableId] = row;
  return seated;
}

/** Tables at one branch, for a dine-in picker. */
export async function tableOptions(principal, branchId, { activeOnly = true } = {}) {
  if (!branchId) return [];
  const filter = branchFilter(branchScope(principal, "tables.read"));
  return prisma.restaurantTable.findMany({
    where: {
      branchId,
      ...(activeOnly ? { isActive: true } : {}),
      ...(filter ? { AND: [{ branchId: filter }] } : {}),
    },
    select: { id: true, name: true, area: true, seats: true, isActive: true },
    orderBy: [{ area: "asc" }, { name: "asc" }],
    take: 500,
  });
}

/** Distinct area names at a branch, so the form can offer what already exists. */
export async function areaOptions(branchId) {
  if (!branchId) return [];
  const rows = await prisma.restaurantTable.findMany({
    where: { branchId, area: { not: null } },
    select: { area: true },
    distinct: ["area"],
    orderBy: { area: "asc" },
  });
  return rows.map((row) => row.area);
}

/**
 * Kitchen stations.
 *
 * Company-wide, not per branch: a station is a kind of work — grill, fryer,
 * cold — and `KitchenStation` has no branch column. Filtering by one would
 * return nothing and leave every board stuck on "every station".
 */
export async function stationOptions() {
  return prisma.kitchenStation.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

/**
 * The menu the counter sells from — the same one the website shows.
 *
 * Deliberately `getOrderMenu` rather than a bespoke admin query: a counter
 * that can sell something the website has taken off the menu is a counter that
 * sells food the kitchen has run out of. Unavailable items are included so the
 * screen can grey them out and say why, which is more use than hiding them
 * when a customer is standing there asking.
 */
export async function counterMenu({ branchId, type = "DINE_IN", at = new Date() }) {
  if (!branchId) return null;
  return getOrderMenu({ branchIdOrCode: branchId, orderType: type, at, includeUnavailable: true });
}

/** Customers matching a search, for attaching an order to an account. */
export async function customerSearch(term, { take = 10 } = {}) {
  const text = String(term ?? "").trim();
  if (text.length < 2) return [];

  return prisma.user.findMany({
    where: {
      deletedAt: null,
      OR: [
        { name: { contains: text, mode: "insensitive" } },
        { email: { contains: text, mode: "insensitive" } },
        { phone: { contains: text, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true, phone: true },
    orderBy: { name: "asc" },
    take,
  });
}

/** Where a customer's deliveries can go. */
export async function customerAddresses(userId) {
  if (!userId) return [];
  return prisma.address.findMany({
    where: { userId, deletedAt: null },
    select: { id: true, label: true, line1: true, city: true, isDefault: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    take: 20,
  });
}

/**
 * The cash drawer this person is working out of, if one is open.
 *
 * Looked up rather than asked for, because a cashier should not have to know
 * their register's id to take a note off a customer — and cash taken with no
 * drawer attached is cash nobody notices is missing at close.
 */
export async function openRegister(principal, branchId) {
  if (!branchId || !can(principal, "payments.mark_collected", { branchId })) return null;
  return openSessionFor({ branchId, userId: principal.userId }).catch(() => null);
}

/** Menus, categories and products a QR code can point at. */
export async function qrTargetOptions(branchId) {
  const [menus, categories, products] = await Promise.all([
    branchId
      ? prisma.menu.findMany({
          where: { branchId, isActive: true },
          select: { id: true, name: true, type: true },
          orderBy: { name: "asc" },
          take: 100,
        })
      : [],
    prisma.category.findMany({
      // Categories are not soft-deleted; `isActive` is the whole story.
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 500,
    }),
    prisma.product.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 1000,
    }),
  ]);
  return { menus, categories, products };
}

/** Display names for the loose actor columns these records carry. */
export async function userNames(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return Object.fromEntries(users.map((user) => [user.id, user.name]));
}
