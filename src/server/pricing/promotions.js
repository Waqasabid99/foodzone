import { Prisma } from "@/generated/prisma";
import { money } from "@/server/pricing/engine";

/**
 * The promotion rules engine.
 *
 * Like the pricing engine next door, this is **pure**: it takes already-priced
 * lines, a context describing the order, and the candidate promotions loaded
 * from the database, and returns the discounts to apply. No database, no clock.
 *
 * That matters more here than anywhere else in the system. A promotion is the
 * one feature whose bugs hand money away, and they do it quietly — a stacking
 * rule that lets two half-price offers combine, a percentage that ignores its
 * own cap, a "buy one get one" that gives away the expensive one. Every one of
 * those is an arithmetic property of this file and nothing else, so every one
 * of them can be pinned down by a test that needs no fixtures.
 *
 * Two rules run through all of it:
 *
 *   * **Eligibility is decided before value.** A promotion that does not apply
 *     is never priced, so a cap or a rounding bug cannot resurrect it.
 *   * **A discount can never exceed what it discounts.** Every branch below
 *     clamps to the eligible subtotal, and the pricing engine clamps again
 *     against the order total. Two independent clamps, because a negative
 *     grand total is a refund the restaurant never agreed to.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);
const ZERO = D(0);

/** Why a promotion did not apply. Surfaced so a coupon box can say something useful. */
export const RejectionReason = {
  INACTIVE: "INACTIVE",
  NOT_STARTED: "NOT_STARTED",
  EXPIRED: "EXPIRED",
  WRONG_DAY: "WRONG_DAY",
  WRONG_TIME: "WRONG_TIME",
  WRONG_BRANCH: "WRONG_BRANCH",
  WRONG_CHANNEL: "WRONG_CHANNEL",
  WRONG_ORDER_TYPE: "WRONG_ORDER_TYPE",
  BELOW_MINIMUM: "BELOW_MINIMUM",
  TOO_FEW_ITEMS: "TOO_FEW_ITEMS",
  NOT_A_NEW_CUSTOMER: "NOT_A_NEW_CUSTOMER",
  USAGE_LIMIT_REACHED: "USAGE_LIMIT_REACHED",
  USER_LIMIT_REACHED: "USER_LIMIT_REACHED",
  REQUIRES_COUPON: "REQUIRES_COUPON",
  NO_ELIGIBLE_ITEMS: "NO_ELIGIBLE_ITEMS",
  NO_VALUE: "NO_VALUE",
};

const MESSAGES = {
  INACTIVE: "This offer is not available",
  NOT_STARTED: "This offer has not started yet",
  EXPIRED: "This offer has expired",
  WRONG_DAY: "This offer is not available today",
  WRONG_TIME: "This offer is not available at this time of day",
  WRONG_BRANCH: "This offer is not available at this branch",
  WRONG_CHANNEL: "This offer is not available on this app",
  WRONG_ORDER_TYPE: "This offer does not apply to this kind of order",
  BELOW_MINIMUM: "Your order is below the minimum for this offer",
  TOO_FEW_ITEMS: "Add more items to use this offer",
  NOT_A_NEW_CUSTOMER: "This offer is for first orders only",
  USAGE_LIMIT_REACHED: "This offer has been fully claimed",
  USER_LIMIT_REACHED: "You have already used this offer",
  REQUIRES_COUPON: "This offer needs a code",
  NO_ELIGIBLE_ITEMS: "Nothing in your order qualifies for this offer",
  NO_VALUE: "This offer is worth nothing on your order",
};

export function rejectionMessage(reason) {
  return MESSAGES[reason] ?? "This offer cannot be applied";
}

const reject = (reason) => ({ eligible: false, reason, message: rejectionMessage(reason) });

/**
 * Whether a promotion applies at all, ignoring what it is worth.
 *
 * `context` carries `{ branchId, channel, orderType, dayOfWeek, minuteOfDay,
 * at, isNewCustomer, userRedemptions, hasCoupon }`. Day and minute are
 * pre-computed **in the branch's timezone** by the caller, exactly as menu
 * windows are — a happy hour is 5pm where the restaurant is, not in UTC.
 */
export function isPromotionEligible(promotion, context = {}) {
  const {
    branchId = null,
    channel = null,
    orderType = null,
    dayOfWeek = null,
    minuteOfDay = null,
    at = null,
    isNewCustomer = false,
    userRedemptions = 0,
    hasCoupon = false,
  } = context;

  if (!promotion.isActive) return reject(RejectionReason.INACTIVE);

  if (at) {
    const now = new Date(at).getTime();
    if (promotion.startsAt && new Date(promotion.startsAt).getTime() > now) {
      return reject(RejectionReason.NOT_STARTED);
    }
    if (promotion.endsAt && new Date(promotion.endsAt).getTime() < now) {
      return reject(RejectionReason.EXPIRED);
    }
  }

  // An empty array means "everywhere" throughout — an offer with no branch list
  // is a chain-wide offer, not an offer that applies nowhere.
  if (promotion.branchIds?.length && branchId && !promotion.branchIds.includes(branchId)) {
    return reject(RejectionReason.WRONG_BRANCH);
  }
  if (promotion.channels?.length && channel && !promotion.channels.includes(channel)) {
    return reject(RejectionReason.WRONG_CHANNEL);
  }
  if (promotion.orderTypes?.length && orderType && !promotion.orderTypes.includes(orderType)) {
    return reject(RejectionReason.WRONG_ORDER_TYPE);
  }
  if (promotion.daysOfWeek?.length && dayOfWeek != null && !promotion.daysOfWeek.includes(dayOfWeek)) {
    return reject(RejectionReason.WRONG_DAY);
  }

  if (promotion.startMinute != null && promotion.endMinute != null && minuteOfDay != null) {
    // An end past midnight (say 22:00–02:00) is stored as a minute beyond 1440,
    // the same convention branch hours and menu windows use.
    const end = promotion.endMinute;
    const inWindow =
      end > 1440
        ? minuteOfDay >= promotion.startMinute || minuteOfDay < end - 1440
        : minuteOfDay >= promotion.startMinute && minuteOfDay < end;
    if (!inWindow) return reject(RejectionReason.WRONG_TIME);
  }

  if (promotion.newCustomersOnly && !isNewCustomer) return reject(RejectionReason.NOT_A_NEW_CUSTOMER);

  if (promotion.usageLimit != null && promotion.usageCount >= promotion.usageLimit) {
    return reject(RejectionReason.USAGE_LIMIT_REACHED);
  }
  if (promotion.usageLimitPerUser != null && userRedemptions >= promotion.usageLimitPerUser) {
    return reject(RejectionReason.USER_LIMIT_REACHED);
  }
  if (promotion.requiresCoupon && !hasCoupon) return reject(RejectionReason.REQUIRES_COUPON);

  return { eligible: true };
}

/**
 * Splits the order's lines into the ones a promotion covers and the rest.
 *
 * Exclusions win over inclusions. "Everything except alcohol" and "drinks only"
 * on the same promotion has exactly one sane reading — drinks, minus the
 * alcohol — and letting an inclusion re-admit an excluded line would make it
 * possible to build a promotion that discounts something it says it does not.
 */
export function eligibleLines(promotion, lines) {
  const targets = promotion.targets ?? [];
  const includes = targets.filter((target) => !target.isExcluded && target.targetType !== "ORDER");
  const excludes = targets.filter((target) => target.isExcluded);

  const matches = (line, target) => {
    if (target.targetType === "PRODUCT") return line.productId === target.targetId;
    if (target.targetType === "VARIANT") return line.variantId === target.targetId;
    if (target.targetType === "CATEGORY") return line.categoryId === target.targetId;
    return false;
  };

  return lines.filter((line) => {
    if (excludes.some((target) => matches(line, target))) return false;
    // No inclusions at all means the whole order qualifies.
    if (!includes.length) return true;
    return includes.some((target) => matches(line, target));
  });
}

/** Lines on the "buy" or "get" side of a BUY_X_GET_Y, falling back to the eligible set. */
function roleLines(promotion, lines, role) {
  const targets = (promotion.targets ?? []).filter((target) => target.role === role && !target.isExcluded);
  if (!targets.length) return eligibleLines(promotion, lines);

  const scoped = { ...promotion, targets: [...targets, ...(promotion.targets ?? []).filter((t) => t.isExcluded)] };
  return eligibleLines(scoped, lines);
}

/**
 * Explodes lines into individual units, cheapest first.
 *
 * "Buy two get one free" is a rule about items, not about basket lines: three
 * of one product on a single line has to give the same answer as three lines of
 * one. Working in units is what makes those two identical.
 */
function unitsAscending(lines) {
  const units = [];
  for (const line of lines) {
    const each = D(line.lineSubtotal).dividedBy(Math.max(line.quantity, 1));
    for (let index = 0; index < line.quantity; index += 1) units.push(each);
  }
  return units.sort((a, b) => a.comparedTo(b));
}

const sumSubtotal = (lines) => lines.reduce((total, line) => total.plus(D(line.lineSubtotal)), ZERO);

/**
 * What a promotion is worth on this order.
 *
 * Returns `{ amount, appliesTo }`; FREE_DELIVERY returns a null amount, which
 * the pricing engine reads as "the whole fee, whatever it turns out to be".
 */
export function computeDiscount(promotion, { lines, subtotal = null } = {}) {
  const covered = eligibleLines(promotion, lines ?? []);
  const base = subtotal != null && !(promotion.targets ?? []).some((t) => t.targetType !== "ORDER")
    ? D(subtotal)
    : sumSubtotal(covered);

  const cap = (amount) => {
    const capped = promotion.maxDiscountAmount != null
      ? Prisma.Decimal.min(amount, D(promotion.maxDiscountAmount))
      : amount;
    return money(Prisma.Decimal.max(Prisma.Decimal.min(capped, base), ZERO));
  };

  switch (promotion.type) {
    case "FREE_DELIVERY":
      // Amount deliberately unresolved: the fee depends on the free-delivery
      // threshold, which depends on the other discounts.
      return { amount: null, appliesTo: "DELIVERY" };

    case "PERCENTAGE":
      return { amount: cap(base.times(D(promotion.value)).dividedBy(100)), appliesTo: "SUBTOTAL" };

    case "FIXED_AMOUNT":
      return { amount: cap(D(promotion.value)), appliesTo: "SUBTOTAL" };

    case "BUNDLE_PRICE": {
      // "All of this for 999". Worth nothing unless every named product is in
      // the basket, otherwise a bundle price would apply to half a bundle.
      const wanted = (promotion.targets ?? []).filter((t) => !t.isExcluded && t.targetType !== "ORDER");
      const present = new Set(covered.flatMap((line) => [line.productId, line.variantId, line.categoryId]));
      if (wanted.length && !wanted.every((target) => present.has(target.targetId))) {
        return { amount: ZERO, appliesTo: "SUBTOTAL" };
      }
      const bundleBase = sumSubtotal(covered);
      return { amount: cap(Prisma.Decimal.max(bundleBase.minus(D(promotion.value)), ZERO)), appliesTo: "SUBTOTAL" };
    }

    case "FREE_ITEM": {
      // The cheapest qualifying units are the ones given away. A restaurant
      // offering a free side does not mean the most expensive one on the menu.
      const count = Math.max(promotion.getQuantity ?? 1, 1);
      const units = unitsAscending(covered);
      const free = units.slice(0, count).reduce((total, unit) => total.plus(unit), ZERO);
      return { amount: cap(free), appliesTo: "SUBTOTAL" };
    }

    case "BUY_X_GET_Y": {
      const buy = Math.max(promotion.buyQuantity ?? 1, 1);
      const get = Math.max(promotion.getQuantity ?? 1, 1);
      const getSide = roleLines(promotion, lines ?? [], "GET");
      const buySide = roleLines(promotion, lines ?? [], "BUY");

      // With separate buy/get sides the reward is capped by how many full
      // "buy" groups were actually purchased.
      const sameSide = getSide === buySide || getSide.length === buySide.length;
      const units = unitsAscending(getSide);
      const buyCount = buySide.reduce((total, line) => total + line.quantity, 0);

      const groups = sameSide
        ? Math.floor(units.length / (buy + get))
        : Math.floor(buyCount / buy);

      const freeCount = Math.min(groups * get, units.length);
      const free = units.slice(0, freeCount).reduce((total, unit) => total.plus(unit), ZERO);
      const bogoBase = sumSubtotal(getSide);
      const capped = promotion.maxDiscountAmount != null
        ? Prisma.Decimal.min(free, D(promotion.maxDiscountAmount))
        : free;
      return { amount: money(Prisma.Decimal.max(Prisma.Decimal.min(capped, bogoBase), ZERO)), appliesTo: "SUBTOTAL" };
    }

    default:
      return { amount: ZERO, appliesTo: "SUBTOTAL" };
  }
}

/** Eligible, and worth something. */
export function evaluatePromotion(promotion, { lines, subtotal, context }) {
  const eligibility = isPromotionEligible(promotion, context);
  if (!eligibility.eligible) return { ...eligibility, promotion };

  const covered = eligibleLines(promotion, lines ?? []);
  if (!covered.length) return { ...reject(RejectionReason.NO_ELIGIBLE_ITEMS), promotion };

  const coveredSubtotal = sumSubtotal(covered);
  if (promotion.minOrderAmount != null && D(subtotal).lessThan(D(promotion.minOrderAmount))) {
    return { ...reject(RejectionReason.BELOW_MINIMUM), promotion };
  }
  const itemCount = covered.reduce((total, line) => total + line.quantity, 0);
  if (promotion.minItemCount != null && itemCount < promotion.minItemCount) {
    return { ...reject(RejectionReason.TOO_FEW_ITEMS), promotion };
  }

  const { amount, appliesTo } = computeDiscount(promotion, { lines, subtotal });

  // A free-delivery offer is worth nothing on a pickup order, but that is the
  // engine's call once it knows the fee — here a null amount is still a hit.
  if (amount != null && !D(amount).greaterThan(0)) {
    return { ...reject(RejectionReason.NO_VALUE), promotion, coveredSubtotal };
  }

  return {
    eligible: true,
    promotion,
    discount: {
      source: "PROMOTION",
      promotionId: promotion.id,
      label: promotion.name,
      type: promotion.type,
      amount,
      appliesTo,
      isStackable: promotion.isStackable,
      priority: promotion.priority ?? 0,
    },
  };
}

/** Sorts by what the customer gets, then by the priority the operator set. */
function byValueThenPriority(a, b) {
  const value = D(b.discount.amount ?? 0).comparedTo(D(a.discount.amount ?? 0));
  if (value !== 0) return value;
  return (b.discount.priority ?? 0) - (a.discount.priority ?? 0);
}

/**
 * Picks which promotions actually apply.
 *
 * The rules, in the order they bite:
 *
 *   1. **A coupon the customer typed always applies.** They went and found the
 *      code; silently dropping it because an automatic offer scored higher is
 *      the kind of thing that generates support tickets, not goodwill.
 *   2. **A non-stackable promotion is alone.** If the coupon's promotion is
 *      non-stackable, nothing automatic joins it.
 *   3. **Otherwise take the better of** the single best non-stackable offer or
 *      the whole stackable set. Comparing the two is what stops "20% off" and
 *      "flat 100 off" from both being missed because each excluded the other.
 *
 * A FREE_DELIVERY offer has no amount yet, so it is scored as its own thing and
 * never competes with a subtotal discount for the single non-stackable slot.
 */
export function resolvePromotions({ promotions = [], coupons = [], lines = [], subtotal = 0, context = {} }) {
  const evaluated = [];
  const rejected = [];

  for (const promotion of promotions) {
    const result = evaluatePromotion(promotion, { lines, subtotal, context: { ...context, hasCoupon: false } });
    if (result.eligible) evaluated.push(result);
    else rejected.push({ promotionId: promotion.id, name: promotion.name, reason: result.reason, message: result.message });
  }

  // --- coupon-driven -------------------------------------------------------
  const couponDiscounts = [];
  let couponBlocksStacking = false;

  for (const coupon of coupons) {
    const result = evaluatePromotion(coupon.promotion, {
      lines,
      subtotal,
      context: { ...context, hasCoupon: true, userRedemptions: coupon.userRedemptions ?? 0 },
    });
    if (!result.eligible) {
      rejected.push({ couponId: coupon.id, code: coupon.code, reason: result.reason, message: result.message });
      continue;
    }
    couponDiscounts.push({
      ...result.discount,
      source: "COUPON",
      couponId: coupon.id,
      label: coupon.promotion.name,
      code: coupon.code,
    });
    if (!coupon.promotion.isStackable) couponBlocksStacking = true;
  }

  if (couponBlocksStacking) {
    return { discounts: couponDiscounts, rejected };
  }

  // --- automatic -----------------------------------------------------------
  const automatic = evaluated.filter((result) => !result.promotion.requiresCoupon);
  const delivery = automatic.filter((result) => result.discount.appliesTo === "DELIVERY");
  const subtotalOffers = automatic.filter((result) => result.discount.appliesTo === "SUBTOTAL");

  const stackable = subtotalOffers.filter((result) => result.discount.isStackable);
  const exclusive = subtotalOffers.filter((result) => !result.discount.isStackable).sort(byValueThenPriority);

  const stackableTotal = stackable.reduce((total, result) => total.plus(D(result.discount.amount)), ZERO);
  const bestExclusive = exclusive[0] ?? null;

  const chosen = [];
  if (couponDiscounts.length) {
    // The coupon is stackable, so only stackable automatic offers may join it.
    chosen.push(...stackable.map((result) => result.discount));
  } else if (bestExclusive && D(bestExclusive.discount.amount).greaterThan(stackableTotal)) {
    chosen.push(bestExclusive.discount);
    for (const result of stackable) {
      rejected.push({
        promotionId: result.promotion.id,
        name: result.promotion.name,
        reason: "SUPERSEDED",
        message: `A better offer (${bestExclusive.promotion.name}) was applied instead`,
      });
    }
  } else {
    chosen.push(...stackable.map((result) => result.discount));
    if (bestExclusive) {
      rejected.push({
        promotionId: bestExclusive.promotion.id,
        name: bestExclusive.promotion.name,
        reason: "SUPERSEDED",
        message: "Other offers on your order are worth more",
      });
    }
  }

  // Delivery waivers never compete with subtotal discounts: they come off a
  // different number. Only the first one can be worth anything anyway, since
  // the engine caps the set at the fee.
  const bestDelivery = delivery.sort((a, b) => (b.discount.priority ?? 0) - (a.discount.priority ?? 0))[0];
  const deliveryDiscounts = couponDiscounts.some((discount) => discount.appliesTo === "DELIVERY")
    ? []
    : bestDelivery
      ? [bestDelivery.discount]
      : [];

  return { discounts: [...couponDiscounts, ...chosen, ...deliveryDiscounts], rejected };
}
