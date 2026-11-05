import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { branchScope, can } from "@/lib/api/permissions";
import { branchFilter } from "@/server/inventory/access";
import { scopedBranches } from "@/server/content/branch-scope";

/**
 * What the inventory screens need besides the records themselves: the pickers
 * and the names behind the ids.
 *
 * Every option list is cut to what the viewer may act on. A location picker
 * that offers another outlet's store room is a form that fails on submit, and
 * a quieter way of telling a manager what the other branches hold.
 */

const LOCATION_SELECT = {
  id: true,
  name: true,
  code: true,
  type: true,
  isDefault: true,
  isActive: true,
  branchId: true,
  branch: { select: { id: true, name: true } },
};

/** Stock locations inside a permission's scope. */
export async function scopedLocations(principal, permissionKey, { activeOnly = true } = {}) {
  const filter = branchFilter(branchScope(principal, permissionKey));
  return prisma.stockLocation.findMany({
    where: { ...(activeOnly ? { isActive: true } : {}), ...(filter ? { branchId: filter } : {}) },
    select: LOCATION_SELECT,
    orderBy: [{ branch: { name: "asc" } }, { isDefault: "desc" }, { name: "asc" }],
  });
}

/** Locations where the viewer holds `permissionKey` at that very branch — the ones a form may submit to. */
export async function actionableLocations(principal, permissionKey) {
  const locations = await scopedLocations(principal, permissionKey);
  return locations.filter((location) => can(principal, permissionKey, { branchId: location.branchId }));
}

/** Every active location in the company, names only — the destinations a transfer may go to. */
export async function allActiveLocations() {
  return prisma.stockLocation.findMany({
    where: { isActive: true },
    select: LOCATION_SELECT,
    orderBy: [{ branch: { name: "asc" } }, { name: "asc" }],
  });
}

/** Active items for a picker, with the unit each is counted in. */
export async function itemOptions({ includeInactive = false } = {}) {
  return prisma.inventoryItem.findMany({
    where: includeInactive ? {} : { isActive: true },
    select: {
      id: true,
      name: true,
      sku: true,
      isActive: true,
      averageCost: true,
      type: true,
      uomId: true,
      trackBatches: true,
      isPerishable: true,
      shelfLifeDays: true,
      uom: { select: { id: true, code: true, precision: true } },
      category: { select: { name: true } },
    },
    orderBy: { name: "asc" },
    take: 2000,
  });
}

export async function categoryOptions() {
  return prisma.inventoryCategory.findMany({
    select: { id: true, name: true, isActive: true },
    orderBy: { name: "asc" },
  });
}

export async function unitOptions() {
  return prisma.unitOfMeasure.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true, type: true, precision: true, baseUnitId: true, factor: true },
    orderBy: [{ type: "asc" }, { code: "asc" }],
  });
}

/** Display names for the loose `createdById`-style columns inventory documents carry. */
export async function userNames(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return Object.fromEntries(users.map((user) => [user.id, user.name]));
}

/**
 * The headline numbers for the Stock page, over the viewer's branches.
 *
 * "Low" is per location, as the reorder policy is: a store room with plenty
 * does not make an empty kitchen fridge any less empty.
 */
export async function stockSummary(principal, { branchId = null } = {}) {
  const filter = branchFilter(branchScope(principal, "stock.read"));
  const branchSql = [
    branchId ? Prisma.sql`AND s."branchId" = ${branchId}` : Prisma.empty,
    filter?.in ? Prisma.sql`AND s."branchId" = ANY(${filter.in}::text[])` : Prisma.empty,
    filter?.notIn ? Prisma.sql`AND NOT (s."branchId" = ANY(${filter.notIn}::text[]))` : Prisma.empty,
  ];

  const [row] = await prisma.$queryRaw(Prisma.sql`
    SELECT
      COUNT(*)::int AS "levels",
      COUNT(*) FILTER (WHERE i."reorderLevel" IS NOT NULL AND l.quantity <= i."reorderLevel")::int AS "low",
      COUNT(*) FILTER (WHERE l.quantity < 0)::int AS "negative",
      -- The same sum the valuation report makes, negatives included, so the
      -- tile and the report can never disagree.
      COALESCE(SUM(l.quantity * i."averageCost"), 0)::text AS "value"
    FROM "StockLevel" l
    JOIN "InventoryItem" i ON i.id = l."itemId"
    JOIN "StockLocation" s ON s.id = l."locationId"
    WHERE TRUE ${branchSql[0]} ${branchSql[1]} ${branchSql[2]}
  `);
  return row ?? { levels: 0, low: 0, negative: 0, value: "0" };
}

export { scopedBranches };

/** On-hand at the given locations, keyed `locationId:itemId`, for forms that show "now → after". */
export async function levelMap(locationIds) {
  if (!locationIds.length) return {};
  const levels = await prisma.stockLevel.findMany({
    where: { locationId: { in: locationIds } },
    select: { itemId: true, locationId: true, quantity: true },
  });
  return Object.fromEntries(levels.map((level) => [`${level.locationId}:${level.itemId}`, level.quantity.toString()]));
}
