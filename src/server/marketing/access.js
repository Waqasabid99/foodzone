import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { assertCompanyWide, branchScope, holdsCompanyWide } from "@/lib/api/permissions";
import { branchListWhere, reachesBranchList } from "@/server/access/scope";

/**
 * Who may see and change a promotion or a coupon.
 *
 * This section does not use the shared `recordAccess` helper, and that is
 * deliberate rather than an oversight. Every other table in the system
 * reaches exactly one branch, so `recordAccess` resolves a record to a single
 * id and checks that. A promotion carries `branchIds` — a *list* — and taking
 * the first of them would check one outlet and wave through a promotion that
 * also covers five others. Reusing the wrong helper here would fail open,
 * which is the shape of bug this file exists to prevent.
 *
 * Three states, and all three are real:
 *
 *   * `branchIds: []` — a chain-wide offer. Visible to anyone who may read
 *     promotions, because what the company is offering is not a secret from
 *     its own managers. **Creating or changing one takes a company-wide
 *     grant**, for the same reason a tax rate does: a manager at one outlet
 *     must not be able to put 50% off across every branch.
 *   * `branchIds: [a, b]` — belongs to those outlets. Visible and editable by
 *     someone whose scope covers at least one of them.
 *   * a branch that no longer exists — the promotion is dead, since the
 *     pricing engine can never match it. It stays visible to a company-wide
 *     reader so somebody can clear it up.
 *
 * **A coupon code is a bearer token.** It reaches a branch only through its
 * promotion, and an unscoped list hands every code in the company to anyone
 * who can read one outlet's — codes they can spend, or pass on.
 */

/**
 * A promotion `where` clause for the caller's branches. Empty when
 * unrestricted.
 *
 * The array handling — an empty list meaning the whole chain, and the
 * "everywhere except" carve-out that Postgres array operators cannot express
 * — lives in `branchListWhere`, because the creator program's commission
 * rules have exactly the same shape and two copies of that reasoning would
 * drift apart.
 */
export async function promotionScopeWhere(scope) {
  return branchListWhere(scope, prisma);
}

/** The same cut, applied to a coupon through the promotion behind it. */
export async function couponScopeWhere(scope) {
  const where = await promotionScopeWhere(scope);
  return Object.keys(where).length ? { promotion: where } : {};
}

/** Whether a set of branch ids is reachable by the caller. */
export function reachesPromotion(principal, branchIds, permissionKey) {
  return reachesBranchList(principal, branchIds, permissionKey);
}

/**
 * Reading one promotion.
 *
 * 404 rather than 403 when it belongs to other branches: "that campaign
 * exists elsewhere" is itself something a scoped manager has no business
 * learning, and a 403 confirms the id is real.
 */
export async function assertPromotionAccess(principal, promotionId, permissionKey) {
  const promotion = await prisma.promotion.findUnique({
    where: { id: promotionId },
    select: { id: true, branchIds: true },
  });
  if (!promotion) throw ApiError.notFound("Promotion not found");
  if (!reachesPromotion(principal, promotion.branchIds, permissionKey)) {
    throw ApiError.notFound("Promotion not found");
  }
  return promotion;
}

export async function assertCouponAccess(principal, couponId, permissionKey) {
  const coupon = await prisma.coupon.findUnique({
    where: { id: couponId },
    select: { id: true, promotion: { select: { id: true, branchIds: true } } },
  });
  if (!coupon) throw ApiError.notFound("Coupon not found");
  if (!reachesPromotion(principal, coupon.promotion?.branchIds, permissionKey)) {
    throw ApiError.notFound("Coupon not found");
  }
  return coupon;
}

/**
 * Who may write a promotion covering these branches.
 *
 * An empty list means every outlet, now and any opened later, so it takes a
 * company-wide grant. A named list has to sit inside what the caller holds —
 * otherwise a manager at one branch could write an offer that also runs at
 * another, which is the same thing by a longer route.
 */
export function assertPromotionReach(principal, branchIds, permissionKey) {
  if (principal?.isSuperAdmin) return;

  if (!branchIds?.length) {
    assertCompanyWide(principal, permissionKey);
    return;
  }

  if (holdsCompanyWide(principal, permissionKey)) return;

  const scope = branchScope(principal, permissionKey);
  const outside = branchIds.filter((id) => !scope.ids.includes(id));
  if (outside.length) {
    throw ApiError.forbidden("That offer would run at a branch you do not cover", {
      required: [permissionKey],
      branchIds: outside,
    });
  }
}
