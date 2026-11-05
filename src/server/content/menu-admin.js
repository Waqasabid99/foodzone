import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { branchScope } from "@/lib/api/permissions";
import { zonedNow } from "@/server/services/branch.service";
import { listAllMenuItems, menuMatchesAt, pickActiveMenu } from "@/server/services/menu.service";
import { menuLiveState } from "@/lib/menu-schedule";
import { scopedBranches } from "@/server/content/branch-scope";

export { scopedBranches };

/**
 * What the Menus pages read: menus with where each one stands right now.
 *
 * "Is this menu live?" cannot be answered from the menu alone. A branch picks
 * one menu per channel from all of its active ones, so whether this one shows
 * depends on the others — which is why every read here loads the competitors
 * too, and why the answer is computed with the same functions checkout uses.
 */

const MENU_FIELDS = {
  id: true,
  branchId: true,
  name: true,
  slug: true,
  type: true,
  description: true,
  activeFrom: true,
  activeTo: true,
  startMinute: true,
  endMinute: true,
  daysOfWeek: true,
  isActive: true,
  isDefault: true,
  updatedAt: true,
};

const BRANCH_FIELDS = { id: true, name: true, code: true, timezone: true, isActive: true, currency: true };

function scopeWhere(scope) {
  if (scope.all) return scope.except.length ? { branchId: { notIn: scope.except } } : {};
  return { branchId: { in: scope.ids } };
}

/** Live state for each menu, judged against every active menu on its branch and channel. */
async function withLiveState(menus, now) {
  const branchIds = [...new Set(menus.map((menu) => menu.branchId))];
  const competitors = branchIds.length
    ? await prisma.menu.findMany({ where: { branchId: { in: branchIds }, isActive: true }, select: MENU_FIELDS })
    : [];

  const pools = new Map();
  for (const menu of competitors) {
    const key = `${menu.branchId}:${menu.type}`;
    if (!pools.has(key)) pools.set(key, []);
    pools.get(key).push(menu);
  }

  return menus.map((menu) => {
    const clock = { ...zonedNow(menu.branch.timezone, now), at: now };
    const picked = pickActiveMenu(pools.get(`${menu.branchId}:${menu.type}`) ?? [], clock);
    return { ...menu, live: menuLiveState({ menu, matchesNow: menuMatchesAt(menu, clock), picked, now }) };
  });
}

const OVERVIEW_CAP = 500;

export async function menuOverview({ principal, branchId = null, type = null, now = new Date() }) {
  const rows = await prisma.menu.findMany({
    where: {
      AND: [scopeWhere(branchScope(principal, "menus.read")), branchId ? { branchId } : {}, type ? { type } : {}],
    },
    select: { ...MENU_FIELDS, branch: { select: BRANCH_FIELDS }, _count: { select: { sections: true } } },
    orderBy: [{ branch: { name: "asc" } }, { type: "asc" }, { name: "asc" }, { id: "asc" }],
    take: OVERVIEW_CAP + 1,
  });
  const menus = rows.slice(0, OVERVIEW_CAP);

  // Products, not rows: a pizza in three sizes is one thing on the menu.
  const ids = menus.map((menu) => menu.id);
  const counts = ids.length
    ? await prisma.$queryRaw(Prisma.sql`
        SELECT "menuId", COUNT(DISTINCT "productId")::int AS "products"
        FROM "MenuItem" WHERE "menuId" = ANY(${ids}) GROUP BY "menuId"`)
    : [];
  const productCount = new Map(counts.map((row) => [row.menuId, row.products]));

  const shaped = menus.map(({ _count, ...menu }) => ({
    ...menu,
    sectionCount: _count.sections,
    productCount: productCount.get(menu.id) ?? 0,
  }));

  return { menus: await withLiveState(shaped, now), truncated: rows.length > OVERVIEW_CAP };
}

/** One menu with everything its editor shows. Null when it does not exist. */
export async function menuWorkspace(id, { now = new Date() } = {}) {
  const menu = await prisma.menu.findUnique({
    where: { id },
    select: {
      ...MENU_FIELDS,
      branch: { select: BRANCH_FIELDS },
      sections: {
        select: { id: true, name: true, description: true, sortOrder: true, isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      },
      _count: { select: { qrCodes: true } },
    },
  });
  if (!menu) return null;

  const [{ items, truncated }, [withLive], fallback] = await Promise.all([
    listAllMenuItems(id),
    withLiveState([menu], now),
    // Delivery and pickup orders fall back to the dine-in menu when their own
    // channel has nothing live (see `buildMenuIndex`), which changes what a
    // "not live" delivery menu actually means for customers.
    ["DELIVERY", "TAKEAWAY"].includes(menu.type) ? liveMenuFor(menu.branch, "DINE_IN", now) : null,
  ]);

  const { _count, ...rest } = withLive;
  return { menu: { ...rest, qrCodeCount: _count.qrCodes }, items, truncated, dineInFallback: fallback };
}

async function liveMenuFor(branch, type, now) {
  const menus = await prisma.menu.findMany({ where: { branchId: branch.id, type, isActive: true }, select: MENU_FIELDS });
  const picked = pickActiveMenu(menus, { ...zonedNow(branch.timezone, now), at: now });
  return picked ? { id: picked.id, name: picked.name } : null;
}
