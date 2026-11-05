import { prisma } from "@/lib/prisma";
import { branchScope, can } from "@/lib/api/permissions";
import { creatorScopeWhere, earningScopeWhere, ruleScopeWhere, videoScopeWhere } from "@/server/creator/access";
import { scopedBranches } from "@/server/content/branch-scope";

/**
 * What the creator screens need besides the records themselves: the counts
 * on the tabs, the pickers, and the programme's own settings.
 *
 * The split here follows the one argued in `server/creator/access.js`.
 * Creator and video counts are chain-wide facts and are counted across the
 * company; anything that is money is cut to the viewer's branches.
 */

export { scopedBranches };

export async function actionableBranches(principal, permissionKey) {
  const branches = await scopedBranches(principal, permissionKey);
  return branches.filter((branch) => branch.isActive && can(principal, permissionKey, { branchId: branch.id }));
}

/** The programme's configured limits, which several screens quote at people. */
export async function programLimits() {
  const config = await prisma.creatorProgramConfig.findUnique({ where: { id: "default" } });
  return {
    isEnabled: config?.isEnabled ?? true,
    minVideoSeconds: config?.minVideoSeconds ?? 15,
    maxVideoSeconds: config?.maxVideoSeconds ?? 30,
    maxUploadAttempts: config?.maxUploadAttempts ?? 5,
    earningHoldDays: config?.earningHoldDays ?? 7,
    suspendAtStrikePoints: config?.suspendAtStrikePoints ?? 3,
    banAtStrikePoints: config?.banAtStrikePoints ?? 5,
    autoApproveVideos: config?.autoApproveVideos ?? false,
    allowSelfPurchaseEarning: config?.allowSelfPurchaseEarning ?? false,
  };
}

/** How many creators sit in each status, within the viewer's branches. */
export async function creatorCounts(principal) {
  const where = creatorScopeWhere(branchScope(principal, "creators.read"));
  const rows = await prisma.creatorProfile.groupBy({
    by: ["status"],
    ...(Object.keys(where).length ? { where } : {}),
    _count: { _all: true },
  });
  const counts = Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
  counts.all = rows.reduce((sum, row) => sum + row._count._all, 0);
  return counts;
}

/**
 * How many videos sit in each status, within the viewer's branches.
 *
 * Cut the same way the list is — through the product each video sells — or
 * the tab counts would promise rows the list then refuses to show.
 */
export async function videoCounts(principal) {
  const where = videoScopeWhere(branchScope(principal, "creator_videos.read"));
  const rows = await prisma.creatorVideo.groupBy({
    by: ["status"],
    ...(Object.keys(where).length ? { where } : {}),
    _count: { _all: true },
  });
  const counts = Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
  counts.all = rows.reduce((sum, row) => sum + row._count._all, 0);
  return counts;
}

/** How many earnings sit in each status, within the viewer's branches. */
export async function earningCounts(principal, { branchId = null } = {}) {
  const where = earningScopeWhere(branchScope(principal, "creator_earnings.read"), branchId);
  const rows = await prisma.creatorEarning.groupBy({
    by: ["status"],
    where: Object.keys(where).length ? where : {},
    _count: { _all: true },
  });
  const counts = Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
  counts.all = rows.reduce((sum, row) => sum + row._count._all, 0);
  return counts;
}

/** How many rules are on and off, within the viewer's branches. */
export async function ruleCounts(principal) {
  const reach = await ruleScopeWhere(branchScope(principal, "creator_commission_rules.read"));
  const rows = await prisma.creatorCommissionRule.findMany({
    where: Object.keys(reach).length ? reach : {},
    select: { isActive: true },
  });
  return {
    all: rows.length,
    active: rows.filter((row) => row.isActive).length,
    inactive: rows.filter((row) => !row.isActive).length,
  };
}

/** Creators for a picker: a rule may be pinned to one negotiated rate. */
export async function creatorOptions({ search = null, take = 50 } = {}) {
  const rows = await prisma.creatorProfile.findMany({
    where: {
      status: { in: ["ACTIVE", "PENDING"] },
      ...(search
        ? {
            OR: [
              { handle: { contains: search, mode: "insensitive" } },
              { displayName: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: { id: true, handle: true, displayName: true },
    orderBy: { displayName: "asc" },
    take,
  });
  return rows.map((row) => ({ value: row.id, label: `${row.displayName} (@${row.handle})` }));
}

/** Names for the branch ids a rule carries, so a dead one can be called dead. */
export async function branchNames(ids) {
  const unique = [...new Set((ids ?? []).flat().filter(Boolean))];
  if (!unique.length) return {};
  const rows = await prisma.branch.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return Object.fromEntries(rows.map((row) => [row.id, row.name]));
}

/** Names for the products a rule or a video points at. */
export async function productNames(ids) {
  const unique = [...new Set((ids ?? []).flat().filter(Boolean))];
  if (!unique.length) return {};
  const rows = await prisma.product.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return Object.fromEntries(rows.map((row) => [row.id, row.name]));
}


/** The branch each video's proof-of-purchase order was placed at. */
export async function videoOrderBranches(videoIds = []) {
  const unique = [...new Set(videoIds.filter(Boolean))];
  if (!unique.length) return {};
  const rows = await prisma.creatorVideo.findMany({
    where: { id: { in: unique } },
    select: { id: true, order: { select: { branchId: true, orderNumber: true } } },
  });
  return Object.fromEntries(rows.map((row) => [row.id, row.order]));
}
