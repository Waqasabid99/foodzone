import { prisma } from "@/lib/prisma";
import { couponScopeWhere } from "@/server/marketing/access";
import { ApiError } from "@/lib/api";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { shortCode } from "@/server/utils/crypto";
import { rejectionMessage } from "@/server/pricing/promotions";

/**
 * Coupons: the codes that unlock a promotion.
 *
 * A coupon is deliberately *not* a discount. It is a key; the promotion behind
 * it holds every rule about what the discount does. That split is what lets a
 * campaign issue ten thousand printed codes that all obey one rule, and lets
 * that rule be changed once rather than ten thousand times.
 *
 * Codes are compared case-insensitively and stored uppercase. A customer typing
 * `save20` off a flyer that reads `SAVE20` has done nothing wrong, and a system
 * that treats those as different codes generates support tickets for no reason.
 */

/** Codes are stored and compared in one canonical form. */
export function normaliseCode(code) {
  return String(code ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

const PROMOTION_SELECT = {
  id: true,
  name: true,
  description: true,
  type: true,
  value: true,
  maxDiscountAmount: true,
  minOrderAmount: true,
  minItemCount: true,
  buyQuantity: true,
  getQuantity: true,
  branchIds: true,
  channels: true,
  orderTypes: true,
  daysOfWeek: true,
  startMinute: true,
  endMinute: true,
  startsAt: true,
  endsAt: true,
  newCustomersOnly: true,
  isStackable: true,
  priority: true,
  usageLimit: true,
  usageLimitPerUser: true,
  usageCount: true,
  requiresCoupon: true,
  isActive: true,
  targets: { select: { id: true, targetType: true, targetId: true, isExcluded: true, role: true } },
};

const SELECT = {
  id: true,
  code: true,
  promotionId: true,
  description: true,
  assignedToId: true,
  maxRedemptions: true,
  maxRedemptionsPerUser: true,
  redemptionCount: true,
  startsAt: true,
  expiresAt: true,
  isActive: true,
  campaign: true,
  createdAt: true,
  updatedAt: true,
};

export async function listCoupons({ limit = 20, cursor, promotionId, campaign, isActive, search, scope = null } = {}) {
  // A code is a bearer token. Unfiltered, this hands every discount in the
  // company to anyone who can read one outlet's.
  const reach = await couponScopeWhere(scope);
  const rows = await prisma.coupon.findMany({
    where: {
      ...(Object.keys(reach).length ? { AND: [reach] } : {}),
      ...(promotionId ? { promotionId } : {}),
      ...(campaign ? { campaign } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(search ? { code: { contains: normaliseCode(search) } } : {}),
    },
    select: { ...SELECT, promotion: { select: { id: true, name: true, type: true, value: true } } },
    orderBy: { createdAt: "desc" },
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

export async function getCoupon(id) {
  const coupon = await prisma.coupon.findUnique({
    where: { id },
    select: { ...SELECT, promotion: { select: { id: true, name: true, type: true, value: true, isActive: true } } },
  });
  if (!coupon) throw ApiError.notFound("Coupon not found");
  return coupon;
}

async function assertPromotionExists(promotionId) {
  const promotion = await prisma.promotion.findUnique({ where: { id: promotionId }, select: { id: true } });
  if (!promotion) throw ApiError.validation("Promotion not found", { promotionId: ["No such promotion"] });
}

export async function createCoupon(data, actor = null) {
  await assertPromotionExists(data.promotionId);

  const code = normaliseCode(data.code);
  const clash = await prisma.coupon.findUnique({ where: { code }, select: { id: true } });
  if (clash) throw ApiError.conflict(`The code "${code}" is already in use`);

  if (data.assignedToId) {
    const user = await prisma.user.findUnique({ where: { id: data.assignedToId }, select: { id: true } });
    if (!user) throw ApiError.validation("User not found", { assignedToId: ["No such user"] });
  }

  return prisma.coupon.create({
    data: { ...data, code, createdById: actor?.userId ?? null },
    select: SELECT,
  });
}

/**
 * Generates a batch of unique codes.
 *
 * Two things make this harder than a loop around `createCoupon`. Codes are
 * random, so a batch of ten thousand will collide with itself and with codes
 * already issued; and a batch is a marketing artefact, so it is written under
 * one `campaign` tag that can revoke the whole run in one statement if the
 * codes leak.
 *
 * `createMany` with `skipDuplicates` does the collision handling in the
 * database — the only place that can see both the existing rows and the batch
 * — and the shortfall is retried rather than assumed away.
 */
export async function generateCoupons({ promotionId, count, prefix = "", length = 8, campaign, ...rest }, actor = null) {
  await assertPromotionExists(promotionId);

  const cleanPrefix = normaliseCode(prefix);
  const tag = campaign ?? `batch-${Date.now()}`;
  const created = [];
  // Every row *this call* inserted. The surplus is removed by id from this
  // set rather than by campaign tag: a second run under a name already in
  // use would otherwise delete the first run's live codes, which customers
  // may be holding.
  const insertedHere = new Set();

  // Bounded retries rather than `while (created.length < count)`: if the code
  // space is too small for the batch, this must fail loudly instead of spinning
  // forever trying to find room that does not exist.
  for (let attempt = 0; attempt < 8 && created.length < count; attempt += 1) {
    const wanted = count - created.length;
    const codes = new Set();
    // Over-generate: some will collide, and a second round trip costs more than
    // a few extra random strings.
    while (codes.size < wanted * 1.2 + 5 && codes.size < wanted * 3 + 10) {
      codes.add(`${cleanPrefix}${shortCode(length)}`);
    }

    const rows = [...codes].slice(0, Math.ceil(wanted * 1.2) + 5).map((code) => ({
      code,
      promotionId,
      campaign: tag,
      createdById: actor?.userId ?? null,
      ...rest,
    }));

    const wantedCodes = rows.map((row) => row.code);

    // Which of these already exist, before anything is written. A code is
    // globally unique, so a collision may sit in another campaign entirely —
    // without this, an existing code is found again afterwards and reported
    // as freshly generated, quietly adopting somebody else's voucher.
    const taken = new Set(
      (await prisma.coupon.findMany({ where: { code: { in: wantedCodes } }, select: { code: true } })).map((row) => row.code),
    );

    await prisma.coupon.createMany({ data: rows, skipDuplicates: true });

    const inserted = await prisma.coupon.findMany({
      where: { code: { in: wantedCodes.filter((code) => !taken.has(code)) } },
      select: { id: true, code: true },
    });

    for (const row of inserted) {
      insertedHere.add(row.id);
      if (created.length < count && !created.some((existing) => existing.id === row.id)) created.push(row);
    }
  }

  if (created.length < count) {
    throw ApiError.conflict(
      `Only ${created.length} of ${count} codes could be generated without collisions. Use a longer code or a prefix.`,
    );
  }

  // Anything over-generated is deleted, so the batch is exactly what was asked
  // for and no unaccounted-for live codes are left behind. Scoped to the ids
  // this call created — never to the campaign tag, which is a label anyone
  // may reuse.
  const keep = new Set(created.map((row) => row.id));
  const surplus = [...insertedHere].filter((id) => !keep.has(id));
  if (surplus.length) await prisma.coupon.deleteMany({ where: { id: { in: surplus } } });

  return { campaign: tag, count: created.length, codes: created.map((row) => row.code) };
}

export async function updateCoupon(id, data) {
  await getCoupon(id);

  if (data.code) {
    const code = normaliseCode(data.code);
    const clash = await prisma.coupon.findFirst({ where: { code, id: { not: id } }, select: { id: true } });
    if (clash) throw ApiError.conflict(`The code "${code}" is already in use`);
    data = { ...data, code };
  }

  return prisma.coupon.update({ where: { id }, data, select: SELECT });
}

export async function deleteCoupon(id) {
  const coupon = await prisma.coupon.findUnique({
    where: { id },
    select: { id: true, _count: { select: { redemptions: true } } },
  });
  if (!coupon) throw ApiError.notFound("Coupon not found");

  if (coupon._count.redemptions > 0) {
    throw ApiError.conflict("This code has been redeemed. Deactivate it instead of deleting it.");
  }

  await prisma.coupon.delete({ where: { id } });
  return { deleted: true, id };
}

/** Revokes a whole printed run at once — what you reach for when codes leak. */
export async function revokeCampaign(campaign, { scope = null } = {}) {
  // Revoking by tag is a blunt instrument: it reaches every coupon carrying
  // that campaign name, and nothing stops two outlets choosing the same one.
  // Cut to the caller's branches so a manager killing their own batch cannot
  // also kill somebody else's that happens to share a label.
  const reach = await couponScopeWhere(scope);
  const where = { campaign, ...(Object.keys(reach).length ? { AND: [reach] } : {}) };

  const { count } = await prisma.coupon.updateMany({ where, data: { isActive: false } });
  if (!count) throw ApiError.notFound("No coupons found for that campaign");
  return { campaign, revoked: count };
}

/**
 * Resolves a typed code into something the promotion engine can price.
 *
 * Everything here is a property of the *coupon*: whether the code exists, is
 * live, is this customer's, and has redemptions left. Whether the resulting
 * discount applies to this particular basket is the promotion engine's
 * question, and is deliberately not answered here.
 *
 * A code that does not exist and a code that is not yours return the same
 * message. Distinguishing them turns the coupon box into an oracle for
 * enumerating other people's personal codes.
 */
export async function validateCoupon({ code, userId = null, at = new Date() }) {
  const normalised = normaliseCode(code);
  if (!normalised) throw ApiError.validation("Enter a code", { code: ["Required"] });

  const coupon = await prisma.coupon.findUnique({
    where: { code: normalised },
    select: { ...SELECT, promotion: { select: PROMOTION_SELECT } },
  });

  const unusable = (message) => ({ valid: false, code: normalised, message });

  if (!coupon || !coupon.isActive) return unusable("That code is not valid");
  if (coupon.assignedToId && coupon.assignedToId !== userId) return unusable("That code is not valid");
  if (!coupon.promotion?.isActive) return unusable(rejectionMessage("INACTIVE"));

  const now = new Date(at).getTime();
  if (coupon.startsAt && new Date(coupon.startsAt).getTime() > now) {
    return unusable(rejectionMessage("NOT_STARTED"));
  }
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < now) {
    return unusable(rejectionMessage("EXPIRED"));
  }
  if (coupon.maxRedemptions != null && coupon.redemptionCount >= coupon.maxRedemptions) {
    return unusable(rejectionMessage("USAGE_LIMIT_REACHED"));
  }

  let userRedemptions = 0;
  if (userId) {
    userRedemptions = await prisma.couponRedemption.count({
      where: { couponId: coupon.id, userId, order: { status: { not: "CANCELLED" } } },
    });
    if (coupon.maxRedemptionsPerUser != null && userRedemptions >= coupon.maxRedemptionsPerUser) {
      return unusable(rejectionMessage("USER_LIMIT_REACHED"));
    }
  }

  return { valid: true, coupon: { ...coupon, userRedemptions } };
}

/** Redemption history for one code — how a campaign is actually reported on. */
export async function couponRedemptions(couponId, { limit = 20, cursor } = {}) {
  await getCoupon(couponId);

  const rows = await prisma.couponRedemption.findMany({
    where: { couponId },
    select: {
      id: true,
      amount: true,
      createdAt: true,
      userId: true,
      order: { select: { id: true, orderNumber: true, status: true, grandTotal: true } },
    },
    orderBy: { createdAt: "desc" },
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}
