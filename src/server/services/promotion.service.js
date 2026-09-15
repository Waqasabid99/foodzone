import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { zonedNow } from "@/server/services/branch.service";
import { resolvePromotions } from "@/server/pricing/promotions";

/**
 * Promotions: the rows, and getting the right ones in front of the engine.
 *
 * The arithmetic is next door in `pricing/promotions.js` and is pure. This
 * module does the two things that need a database: administering the rules,
 * and loading the candidates for one specific order.
 *
 * Loading is written to be cheap on the hot path. Checkout runs it on every
 * price quote, so it must never be a query per promotion: one indexed read for
 * the live promotions, one for the caller's redemption counts, and the rest is
 * arithmetic in memory.
 */

const TARGET_SELECT = { id: true, targetType: true, targetId: true, isExcluded: true, role: true };

const SELECT = {
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
  createdAt: true,
  updatedAt: true,
  targets: { select: TARGET_SELECT },
};

/**
 * Rules that make a promotion mean what its author thinks it means.
 *
 * These are refused at write time rather than shrugged off at price time,
 * because a promotion that quietly computes to zero looks like a broken
 * checkout to a customer and like a working campaign to the marketer who made
 * it. Better to fail loudly here, once, in an admin screen.
 */
export function assertPromotionIsCoherent(data) {
  const errors = {};
  const type = data.type;
  const value = data.value != null ? Number(data.value) : null;

  if (type === "PERCENTAGE") {
    if (value == null || value <= 0 || value > 100) {
      errors.value = ["A percentage discount must be between 0 and 100"];
    }
  }

  if (type === "FIXED_AMOUNT" || type === "BUNDLE_PRICE") {
    if (value == null || value <= 0) errors.value = ["Set the amount this offer is worth"];
  }

  if (type === "BUY_X_GET_Y") {
    if (!data.buyQuantity || data.buyQuantity < 1) errors.buyQuantity = ["Set how many must be bought"];
    if (!data.getQuantity || data.getQuantity < 1) errors.getQuantity = ["Set how many are free"];
  }

  if (type === "FREE_ITEM" && (!data.getQuantity || data.getQuantity < 1)) {
    errors.getQuantity = ["Set how many items are free"];
  }

  // A cap on anything but a percentage is a contradiction: a fixed 100 off
  // capped at 50 is just 50 off, written in a way nobody will read correctly.
  if (data.maxDiscountAmount != null && type !== "PERCENTAGE" && type !== "BUY_X_GET_Y") {
    errors.maxDiscountAmount = ["A maximum only applies to percentage and buy-x-get-y offers"];
  }

  const hasStart = data.startMinute != null;
  const hasEnd = data.endMinute != null;
  if (hasStart !== hasEnd) {
    errors.startMinute = ["Set both a start and an end time, or neither"];
  }
  if (hasStart && hasEnd && data.endMinute <= data.startMinute) {
    // Past midnight is expressed as an end beyond 1440, so an end that is
    // merely smaller is a mistake rather than an overnight window.
    errors.endMinute = ["The end time must be after the start time; use a value above 1440 to cross midnight"];
  }

  if (data.startsAt && data.endsAt && new Date(data.endsAt) <= new Date(data.startsAt)) {
    errors.endsAt = ["The end date must be after the start date"];
  }

  if (Object.keys(errors).length) throw ApiError.validation("This offer would never apply", errors);
}

/** Targets point at real catalog rows, checked once here rather than at price time. */
async function assertTargetsExist(targets = []) {
  const byType = { PRODUCT: [], VARIANT: [], CATEGORY: [] };
  for (const target of targets) {
    if (target.targetType === "ORDER") continue;
    if (!target.targetId) {
      throw ApiError.validation("A target needs something to point at", {
        targets: [`${target.targetType} targets need a targetId`],
      });
    }
    byType[target.targetType]?.push(target.targetId);
  }

  const [products, variants, categories] = await Promise.all([
    byType.PRODUCT.length
      ? prisma.product.findMany({ where: { id: { in: byType.PRODUCT } }, select: { id: true } })
      : [],
    byType.VARIANT.length
      ? prisma.productVariant.findMany({ where: { id: { in: byType.VARIANT } }, select: { id: true } })
      : [],
    byType.CATEGORY.length
      ? prisma.category.findMany({ where: { id: { in: byType.CATEGORY } }, select: { id: true } })
      : [],
  ]);

  const found = new Set([...products, ...variants, ...categories].map((row) => row.id));
  const missing = [...byType.PRODUCT, ...byType.VARIANT, ...byType.CATEGORY].filter((id) => !found.has(id));
  if (missing.length) {
    throw ApiError.validation("Some targets do not exist", { targets: missing.map((id) => `Unknown id ${id}`) });
  }
}

export async function listPromotions({ limit = 20, cursor, isActive, type, branchId, search } = {}) {
  const rows = await prisma.promotion.findMany({
    where: {
      ...(isActive !== undefined ? { isActive } : {}),
      ...(type ? { type } : {}),
      // An empty `branchIds` means chain-wide, so it has to match too.
      ...(branchId ? { OR: [{ branchIds: { has: branchId } }, { branchIds: { isEmpty: true } }] } : {}),
      ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
    },
    select: { ...SELECT, _count: { select: { coupons: true, discounts: true } } },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);
  return {
    ...page,
    items: page.items.map(({ _count, ...row }) => ({
      ...row,
      couponCount: _count.coupons,
      redemptionCount: _count.discounts,
    })),
  };
}

export async function getPromotion(id) {
  const promotion = await prisma.promotion.findUnique({
    where: { id },
    select: { ...SELECT, _count: { select: { coupons: true, discounts: true } } },
  });
  if (!promotion) throw ApiError.notFound("Promotion not found");

  const { _count, ...rest } = promotion;
  return { ...rest, couponCount: _count.coupons, redemptionCount: _count.discounts };
}

export async function createPromotion(data, actor = null) {
  assertPromotionIsCoherent(data);

  const { targets = [], ...promotion } = data;
  await assertTargetsExist(targets);

  return prisma.promotion.create({
    data: {
      ...promotion,
      createdById: actor?.userId ?? null,
      targets: { create: targets.map(normaliseTarget) },
    },
    select: SELECT,
  });
}

function normaliseTarget(target) {
  return {
    targetType: target.targetType,
    targetId: target.targetType === "ORDER" ? null : target.targetId,
    isExcluded: target.isExcluded ?? false,
    role: target.role ?? null,
  };
}

/**
 * Editing a promotion replaces its targets wholesale when they are supplied.
 *
 * Past orders are untouched: `OrderDiscount` records the amount that was given
 * and the label it was given under, so a campaign can be retuned mid-flight
 * without rewriting what people already paid.
 */
export async function updatePromotion(id, data, actor = null) {
  const existing = await getPromotion(id);
  assertPromotionIsCoherent({ ...existing, ...data });

  const { targets, ...promotion } = data;
  if (targets) await assertTargetsExist(targets);

  return prisma.$transaction(async (tx) => {
    if (targets) {
      await tx.promotionTarget.deleteMany({ where: { promotionId: id } });
      await tx.promotionTarget.createMany({
        data: targets.map((target) => ({ promotionId: id, ...normaliseTarget(target) })),
      });
    }
    return tx.promotion.update({ where: { id }, data: promotion, select: SELECT });
  });
}

export async function setPromotionActive(id, isActive) {
  await getPromotion(id);
  return prisma.promotion.update({ where: { id }, data: { isActive }, select: SELECT });
}

/**
 * A promotion that has ever been given to a customer is deactivated, never
 * deleted: `OrderDiscount.promotionId` is how finance answers "what did this
 * campaign cost us", and a cascade to null would erase the answer.
 */
export async function deletePromotion(id) {
  const promotion = await prisma.promotion.findUnique({
    where: { id },
    select: { id: true, _count: { select: { discounts: true, coupons: true } } },
  });
  if (!promotion) throw ApiError.notFound("Promotion not found");

  if (promotion._count.discounts > 0) {
    throw ApiError.conflict(
      "This offer has been used on orders. Deactivate it instead of deleting it, so its cost stays reportable.",
      { redemptions: promotion._count.discounts },
    );
  }

  await prisma.promotion.delete({ where: { id } });
  return { deleted: true, id };
}

// --- evaluation -------------------------------------------------------------

/**
 * Candidate promotions for one order, narrowed in the database.
 *
 * The date and branch filters are done in SQL because they eliminate almost
 * everything; the day, time and basket rules are done in the engine because
 * they need the branch's timezone and the priced lines.
 */
async function loadCandidates({ branchId, at }) {
  return prisma.promotion.findMany({
    where: {
      isActive: true,
      requiresCoupon: false,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: at } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: at } }] },
        { OR: [{ branchIds: { has: branchId } }, { branchIds: { isEmpty: true } }] },
      ],
    },
    select: SELECT,
    orderBy: { priority: "desc" },
  });
}

/** How many times this customer has already used each of these promotions. */
async function redemptionsByPromotion(userId, promotionIds) {
  if (!userId || !promotionIds.length) return new Map();

  const rows = await prisma.orderDiscount.groupBy({
    by: ["promotionId"],
    where: {
      promotionId: { in: promotionIds },
      // A cancelled order gave nothing away, so it must not consume an
      // allowance the customer never actually spent.
      order: { userId, status: { not: "CANCELLED" } },
    },
    _count: { _all: true },
  });

  return new Map(rows.map((row) => [row.promotionId, row._count._all]));
}

/** Whether this is the customer's first order — what `newCustomersOnly` means. */
async function isNewCustomer(userId) {
  if (!userId) return true;
  const previous = await prisma.order.findFirst({
    where: { userId, status: { not: "CANCELLED" } },
    select: { id: true },
  });
  return !previous;
}

/**
 * Works out every discount an order should get.
 *
 * `coupons` are already-validated rows from the coupon service; automatic
 * promotions are loaded here. Returns the discounts in the shape the pricing
 * engine takes, plus the rejections, so a checkout screen can explain why the
 * code someone typed did nothing.
 */
export async function resolveOrderDiscounts({
  branchId,
  branchTimezone = "UTC",
  orderType,
  channel = "WEB",
  lines,
  subtotal,
  userId = null,
  coupons = [],
  at = new Date(),
}) {
  const candidates = await loadCandidates({ branchId, at });

  const couponPromotionIds = coupons.map((coupon) => coupon.promotionId).filter(Boolean);
  const allIds = [...new Set([...candidates.map((row) => row.id), ...couponPromotionIds])];

  const [redemptions, newCustomer] = await Promise.all([
    redemptionsByPromotion(userId, allIds),
    candidates.some((row) => row.newCustomersOnly) || coupons.some((c) => c.promotion?.newCustomersOnly)
      ? isNewCustomer(userId)
      : Promise.resolve(false),
  ]);

  const { dayOfWeek, minutes } = zonedNow(branchTimezone, at);

  // The per-user cap is the one rule that differs per promotion rather than per
  // order, so it is applied here, before the engine sees the candidates. The
  // engine's context carries a single `userRedemptions`, which cannot express
  // "three of these left but none of those".
  const withinUserCap = candidates.filter(
    (promotion) =>
      promotion.usageLimitPerUser == null ||
      (redemptions.get(promotion.id) ?? 0) < promotion.usageLimitPerUser,
  );

  const context = {
    branchId,
    channel,
    orderType,
    dayOfWeek,
    minuteOfDay: minutes,
    at,
    isNewCustomer: newCustomer,
  };

  return resolvePromotions({
    promotions: withinUserCap,
    coupons: coupons.map((coupon) => ({
      ...coupon,
      userRedemptions: coupon.userRedemptions ?? redemptions.get(coupon.promotionId) ?? 0,
    })),
    lines,
    subtotal,
    context,
  });
}
