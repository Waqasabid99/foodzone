import { prisma } from "@/lib/prisma";
import { branchScope, can } from "@/lib/api/permissions";
import { couponScopeWhere, promotionScopeWhere } from "@/server/marketing/access";
import { scopedBranches } from "@/server/content/branch-scope";

/**
 * What the Marketing screens need besides the offers themselves: the pickers,
 * the counts, and the catalog rows a promotion can point at.
 *
 * Everything that can be cut to the viewer's branches is. The catalog is the
 * exception and deliberately so — products and categories are company data in
 * this system, so a manager building an offer picks from the same menu
 * everyone else sees.
 */

export { scopedBranches };

export async function actionableBranches(principal, permissionKey) {
  const branches = await scopedBranches(principal, permissionKey);
  return branches.filter((branch) => branch.isActive && can(principal, permissionKey, { branchId: branch.id }));
}

/**
 * How many offers sit in each state.
 *
 * Counted in JavaScript rather than grouped in the database, because "live"
 * is not a column — it is `isActive` and the dates and the usage cap read
 * together. A `groupBy isActive` would put an offer that ended in March in
 * the same bucket as one running right now, which is the distinction the
 * tabs exist to make.
 */
export async function promotionCounts(principal, { now = new Date() } = {}) {
  const reach = await promotionScopeWhere(branchScope(principal, "promotions.read"));
  const rows = await prisma.promotion.findMany({
    where: Object.keys(reach).length ? reach : {},
    select: { isActive: true, startsAt: true, endsAt: true, usageLimit: true, usageCount: true },
    take: 5000,
  });

  const counts = { all: rows.length, live: 0, scheduled: 0, paused: 0, expired: 0 };
  for (const row of rows) {
    if (!row.isActive) counts.paused += 1;
    else if (row.usageLimit != null && row.usageCount >= row.usageLimit) counts.expired += 1;
    else if (row.startsAt && row.startsAt > now) counts.scheduled += 1;
    else if (row.endsAt && row.endsAt < now) counts.expired += 1;
    else counts.live += 1;
  }
  return counts;
}

/** Offers a coupon can be attached to. */
export async function promotionOptions(principal, { couponOnly = false } = {}) {
  const reach = await promotionScopeWhere(branchScope(principal, "promotions.read"));
  return prisma.promotion.findMany({
    where: {
      ...(Object.keys(reach).length ? reach : {}),
      ...(couponOnly ? { requiresCoupon: true } : {}),
    },
    select: { id: true, name: true, type: true, value: true, isActive: true, requiresCoupon: true, branchIds: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
}

/** The campaign tags in use, for filtering and for revoking a batch. */
export async function campaignTags(principal) {
  const reach = await couponScopeWhere(branchScope(principal, "coupons.read"));
  const rows = await prisma.coupon.groupBy({
    by: ["campaign"],
    where: {
      campaign: { not: null },
      ...(Object.keys(reach).length ? reach : {}),
    },
    _count: { _all: true },
    orderBy: { _count: { campaign: "desc" } },
    take: 200,
  });
  return rows.map((row) => ({ campaign: row.campaign, count: row._count._all }));
}

/**
 * The catalog rows an offer can target.
 *
 * Capped and searchable rather than returned whole: a restaurant with two
 * thousand variants would otherwise ship all of them into a form that needs
 * about six.
 */
export async function targetOptions({ search = null, take = 50 } = {}) {
  const text = String(search ?? "").trim();
  const like = text ? { contains: text, mode: "insensitive" } : undefined;

  const [categories, products] = await Promise.all([
    // A category has no soft delete — only `isActive`. A product has both.
    prisma.category.findMany({
      where: { isActive: true, ...(like ? { name: like } : {}) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take,
    }),
    prisma.product.findMany({
      where: { deletedAt: null, isActive: true, ...(like ? { name: like } : {}) },
      select: { id: true, name: true, variants: { select: { id: true, name: true, sku: true }, take: 20 } },
      orderBy: { name: "asc" },
      take,
    }),
  ]);

  return { categories, products };
}

/** Names for the target ids an offer already carries. */
export async function targetNames(targets = []) {
  const byType = { PRODUCT: [], VARIANT: [], CATEGORY: [] };
  for (const target of targets) {
    if (target.targetId && byType[target.targetType]) byType[target.targetType].push(target.targetId);
  }

  const [products, variants, categories] = await Promise.all([
    byType.PRODUCT.length ? prisma.product.findMany({ where: { id: { in: byType.PRODUCT } }, select: { id: true, name: true } }) : [],
    byType.VARIANT.length
      ? prisma.productVariant.findMany({
          where: { id: { in: byType.VARIANT } },
          select: { id: true, name: true, product: { select: { name: true } } },
        })
      : [],
    byType.CATEGORY.length ? prisma.category.findMany({ where: { id: { in: byType.CATEGORY } }, select: { id: true, name: true } }) : [],
  ]);

  const names = {};
  for (const row of products) names[row.id] = row.name;
  for (const row of variants) names[row.id] = `${row.product?.name ?? "Product"} — ${row.name}`;
  for (const row of categories) names[row.id] = row.name;
  return names;
}

/** Customers a personal coupon can be assigned to. */
export async function customerSearch({ search = null, take = 20 } = {}) {
  const text = String(search ?? "").trim();
  if (!text) return [];

  return prisma.user.findMany({
    where: {
      deletedAt: null,
      OR: [
        { name: { contains: text, mode: "insensitive" } },
        { email: { contains: text, mode: "insensitive" } },
        { phone: { contains: text } },
      ],
    },
    select: { id: true, name: true, email: true, phone: true },
    orderBy: { name: "asc" },
    take,
  });
}

/** Branch names for ids an offer may carry, including ones since deleted. */
export async function branchNames(ids) {
  const unique = [...new Set((ids ?? []).flat().filter(Boolean))];
  if (!unique.length) return {};
  const rows = await prisma.branch.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return Object.fromEntries(rows.map((row) => [row.id, row.name]));
}

/** Display names for the loose `createdById` columns these records carry. */
export async function userNames(ids) {
  const unique = [...new Set((ids ?? []).filter(Boolean))];
  if (!unique.length) return {};
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return Object.fromEntries(users.map((user) => [user.id, user.name]));
}
