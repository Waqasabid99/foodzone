import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { assertCompanyWide, branchScope, holdsCompanyWide } from "@/lib/api/permissions";
import { branchFilter, branchListWhere, inScope, reachesBranchList, scopeWhere } from "@/server/access/scope";
import { assertProductReach, productScopeWhere, reachesProduct } from "@/server/catalog/access";

/**
 * Who may see and change what in the creator program.
 *
 * This module is mostly about saying which tables are **not** branch data,
 * because getting that wrong in either direction is a real bug and the
 * answers here are not uniform.
 *
 * **A video belongs to the branch of the product it sells.** A video is bound
 * to the order line that proves the purchase and goes live on that product's
 * page, so it reaches exactly as far as the product does: a product pinned to
 * one outlet means a video only that outlet's managers can see or moderate,
 * and a product on the chain's catalogue (`branchId` null) means a video
 * every manager can.
 *
 * That also decides the write side. Approving a video for a branch-owned
 * product changes one outlet's storefront, so a manager at that outlet may do
 * it. Approving one for a chain-wide product puts user-generated video on
 * every outlet's page, so that takes a company-wide grant — the same test the
 * chain-wide product itself got. See `assertPublishReach`.
 *
 * **A creator is a person, and keeps no branch of their own.** One account,
 * one wallet, whichever outlet they happen to buy from. They become visible
 * to a manager by having filmed something that manager sells, which is the
 * same way customers are already scoped through their orders — rather than
 * being stamped with whichever branch they first ordered from and stranded
 * there.
 *
 * **An earning is branch data.** It is a cost booked against one branch's
 * completed order, it lands in that branch's margin, and the role that reads
 * it — accountant — is precisely the one an operator would pin to a single
 * outlet. This is the genuine leak in this section.
 *
 * **A commission rule is branch data**, and has the same `branchIds` list
 * shape as a promotion, including the chain-wide empty list. It is also the
 * sharpest case in the programme, because a rule does not merely reveal
 * money — it *writes* it. A rule saved with an empty `branchIds` pays out on
 * every order in the company, for ever, until somebody notices.
 */

// --- earnings ---------------------------------------------------------------

/**
 * Earnings for the caller's branches, via the order that produced them.
 *
 * Takes the requested branch as well as the scope, and resolves both into one
 * clause, because the two cannot be combined by the caller spreading them
 * into the same object: they both key on `order`, so the second would replace
 * the first and the "filter" would silently widen the result to the whole
 * company. Folding them here means there is one place to get it right rather
 * than one per call site.
 *
 * A requested branch outside the scope matches nothing rather than erroring —
 * same reasoning as the 404s: confirming "that branch exists but is not
 * yours" is itself a disclosure.
 */
export function earningScopeWhere(scope, branchId = null) {
  const filter = branchFilter(scope);

  if (!branchId) return filter ? { order: { branchId: filter } } : {};

  const allowed =
    !filter ||
    (Array.isArray(filter.in) ? filter.in.includes(branchId) : !(filter.notIn ?? []).includes(branchId));

  return { order: { branchId: allowed ? branchId : { in: [] } } };
}

/**
 * Reading one earning.
 *
 * 404 rather than 403 for an out-of-scope row, as everywhere else: "that
 * earning exists at another branch" is itself something a scoped reader has
 * no business learning, and a 403 confirms the id is real.
 */
export async function assertEarningAccess(principal, earningId, permissionKey) {
  const earning = await prisma.creatorEarning.findUnique({
    where: { id: earningId },
    select: { id: true, order: { select: { branchId: true } } },
  });
  if (!earning) throw ApiError.notFound("Earning not found");

  const scope = branchScope(principal, permissionKey);
  if (!principal?.isSuperAdmin && !scopeCovers(scope, earning.order?.branchId)) {
    throw ApiError.notFound("Earning not found");
  }
  return earning;
}

function scopeCovers(scope, branchId) {
  if (!scope || scope.all) return !scope?.except?.includes(branchId);
  return scope.ids.includes(branchId);
}

// --- commission rules -------------------------------------------------------

/** A rule `where` clause for the caller's branches. Empty when unrestricted. */
export async function ruleScopeWhere(scope) {
  return branchListWhere(scope, prisma);
}

/** Whether the caller may read a rule covering these branches. */
export function reachesRule(principal, branchIds, permissionKey) {
  return reachesBranchList(principal, branchIds, permissionKey);
}

export async function assertRuleAccess(principal, ruleId, permissionKey) {
  const rule = await prisma.creatorCommissionRule.findUnique({
    where: { id: ruleId },
    select: { id: true, branchIds: true },
  });
  if (!rule) throw ApiError.notFound("Commission rule not found");
  if (!reachesRule(principal, rule.branchIds, permissionKey)) {
    throw ApiError.notFound("Commission rule not found");
  }
  return rule;
}

/**
 * Who may write a rule covering these branches.
 *
 * An empty list is every outlet, including ones opened later, and the rule
 * spends real money on every order that matches it — so it takes a
 * company-wide grant, for the same reason a chain-wide promotion or a tax
 * rate does. A named list has to sit inside what the caller holds, or a
 * manager at one branch could write a payout that also runs at another.
 */
export function assertRuleReach(principal, branchIds, permissionKey) {
  if (principal?.isSuperAdmin) return;

  if (!branchIds?.length) {
    assertCompanyWide(principal, permissionKey);
    return;
  }

  if (holdsCompanyWide(principal, permissionKey)) return;

  const scope = branchScope(principal, permissionKey);
  const outside = branchIds.filter((id) => !scope.ids.includes(id));
  if (outside.length) {
    throw ApiError.forbidden("That rule would pay out at a branch you do not cover", {
      required: [permissionKey],
      branchIds: outside,
    });
  }
}

// --- videos -----------------------------------------------------------------

/**
 * Videos the caller may see: the ones filmed at an outlet they cover.
 *
 * Read off the video's own `branchId` rather than through its product. The
 * product route treated a chain-wide item as a chain-wide video, so one
 * person's clip of a burger reached every manager in the company — and, on the
 * storefront, every city. A video is one meal bought at one outlet, and it has
 * carried that outlet since it was created.
 */
export function videoScopeWhere(scope) {
  return scopeWhere(scope);
}

/**
 * Creators the caller may see.
 *
 * Derived rather than stored: a creator shows up for a manager once they have
 * filmed something that manager sells. A creator who has joined but not yet
 * had a video approved has no branch footprint, so they are visible to a
 * company-wide reader only — there is no outlet they belong to yet, and
 * guessing one would be worse than saying nothing.
 */
export function creatorScopeWhere(scope) {
  const where = videoScopeWhere(scope);
  return Object.keys(where).length ? { videos: { some: where } } : {};
}

/**
 * Approving, reinstating or pinning a video.
 *
 * It reaches as far as the outlet the video was filmed at — which is one
 * outlet, always. Approving no longer needs a company-wide grant for a
 * chain-wide product, because approving no longer changes anything outside
 * that outlet's own storefront.
 *
 * Rejecting, and taking a live video down, deliberately do **not** go through
 * here. Both make the storefront smaller rather than larger, and a manager
 * who spots something wrong on a page they sell from should be able to act on
 * it without waiting for head office.
 */
export async function assertPublishReach(principal, videoId, permissionKey) {
  if (principal?.isSuperAdmin) return;

  const video = await prisma.creatorVideo.findUnique({
    where: { id: videoId },
    select: { id: true, branchId: true },
  });
  if (!video) throw ApiError.notFound("Video not found");

  if (!inScope(branchScope(principal, permissionKey), video.branchId)) {
    throw ApiError.forbidden("That video belongs to a branch you do not cover", {
      required: [permissionKey],
      branchIds: [video.branchId],
    });
  }
}

/** Reading or moderating one video, through the outlet it was filmed at. */
export async function assertVideoAccess(principal, videoId, permissionKey) {
  const video = await prisma.creatorVideo.findUnique({
    where: { id: videoId },
    select: { id: true, branchId: true },
  });
  if (!video) throw ApiError.notFound("Video not found");
  // Out of scope is 404, not 403: a 403 confirms the id is real.
  if (!principal?.isSuperAdmin && !inScope(branchScope(principal, permissionKey), video.branchId)) {
    throw ApiError.notFound("Video not found");
  }
  return video;
}
