import { Prisma } from "@/generated/prisma";
import { money } from "@/server/accounting/balance";

/**
 * Commission rule resolution.
 *
 * Pure, because this decides what a creator is paid and the awkward cases are
 * all combinatorial: three overlapping rules, a percentage capped at a ceiling,
 * a budget that runs out mid-order, a threshold measured against the order
 * while the reward is measured against the line.
 *
 * The single most important property: **exactly one rule applies per attributed
 * line.** Rules are never stacked. Two overlapping campaigns — "5% on
 * everything" and "200 flat on pizzas" — must not pay both, or a promotion
 * nobody modelled emerges from the combination and the payout is unbounded.
 *
 * Resolution order, applied in turn until one rule is left:
 *
 *   1. **priority**, highest first — the admin's explicit override;
 *   2. **specificity**: a creator-specific rule beats a product rule, which
 *      beats a category rule, which beats a global one. A negotiated rate for
 *      one creator should not be silently outranked by a blanket campaign;
 *   3. **most recently created**, as a last resort, so the answer is
 *      deterministic rather than whatever the database returned first.
 *
 * A rule that matches nothing is not an error: an attributed sale that earns
 * nothing still produces a `NOT_QUALIFIED` earning, because "your video drove a
 * sale that missed the threshold" is information a creator should have.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);
const ZERO = D(0);

/** Why a line earned nothing. Shown to the creator, so it has to read plainly. */
export const DisqualifiedReason = {
  NO_MATCHING_RULE: "NO_MATCHING_RULE",
  BELOW_MIN_ORDER: "BELOW_MIN_ORDER",
  BELOW_MIN_QUANTITY: "BELOW_MIN_QUANTITY",
  SELF_PURCHASE: "SELF_PURCHASE",
  BUDGET_EXHAUSTED: "BUDGET_EXHAUSTED",
  ORDER_CAP_REACHED: "ORDER_CAP_REACHED",
  MONTHLY_CAP_REACHED: "MONTHLY_CAP_REACHED",
  CREATOR_NOT_ACTIVE: "CREATOR_NOT_ACTIVE",
  ZERO_REWARD: "ZERO_REWARD",
};

export function disqualifiedMessage(reason) {
  return (
    {
      NO_MATCHING_RULE: "No commission rule covers this sale",
      BELOW_MIN_ORDER: "The order was below the minimum for any rule",
      BELOW_MIN_QUANTITY: "Too few units were bought to qualify",
      SELF_PURCHASE: "A creator's own purchase does not earn",
      BUDGET_EXHAUSTED: "The campaign budget for this rule is spent",
      ORDER_CAP_REACHED: "This order has already reached its payout cap",
      MONTHLY_CAP_REACHED: "This creator has reached the monthly earnings cap",
      CREATOR_NOT_ACTIVE: "The creator's account is not active",
      ZERO_REWARD: "The rule resolved to nothing",
    }[reason] ?? "This sale did not qualify"
  );
}

/** How specific a rule's targeting is. Higher wins a priority tie. */
export function specificityOf(rule) {
  if (rule.creatorId) return 4;

  const targets = (rule.targets ?? []).filter((target) => !target.isExcluded);
  if (targets.some((target) => ["PRODUCT", "VARIANT"].includes(target.targetType))) return 3;
  if (targets.some((target) => target.targetType === "CATEGORY")) return 2;
  return 1;
}

/**
 * Whether a rule's targeting covers this line.
 *
 * Exclusions beat inclusions, the same way they do in promotions: "everything
 * except alcohol" is expressed as a global rule with an excluded category, and
 * an exclusion that could be outvoted by an inclusion would not express it.
 */
export function ruleTargetsLine(rule, { productId, variantId, categoryId }) {
  const targets = rule.targets ?? [];
  if (!targets.length) return true;

  const matches = (target) => {
    switch (target.targetType) {
      case "PRODUCT":
        return target.targetId === productId;
      case "VARIANT":
        return target.targetId === variantId;
      case "CATEGORY":
        return target.targetId === categoryId;
      case "ORDER":
        return true;
      default:
        return false;
    }
  };

  if (targets.filter((target) => target.isExcluded).some(matches)) return false;

  const included = targets.filter((target) => !target.isExcluded);
  if (!included.length) return true;

  return included.some(matches);
}

/** The amount a basis refers to. */
export function basisAmountFor(basis, { lineAmount, orderSubtotal, orderTotal }) {
  switch (basis) {
    case "ORDER_SUBTOTAL":
      return D(orderSubtotal);
    case "ORDER_TOTAL":
      return D(orderTotal);
    case "ATTRIBUTED_LINE":
    default:
      return D(lineAmount);
  }
}

/**
 * Whether a rule's conditions are met.
 *
 * Returns a reason rather than a bare false, because the reason is what the
 * creator is shown when the sale earns nothing.
 */
export function ruleQualifies(rule, context) {
  const { at = new Date(), branchId, channel, orderType, quantity, creatorId } = context;

  if (!rule.isActive) return { ok: false, reason: DisqualifiedReason.NO_MATCHING_RULE };
  if (rule.startsAt && new Date(rule.startsAt) > at) return { ok: false, reason: DisqualifiedReason.NO_MATCHING_RULE };
  if (rule.endsAt && new Date(rule.endsAt) < at) return { ok: false, reason: DisqualifiedReason.NO_MATCHING_RULE };

  // An empty scope array means "everywhere", not "nowhere".
  if (rule.branchIds?.length && branchId && !rule.branchIds.includes(branchId)) {
    return { ok: false, reason: DisqualifiedReason.NO_MATCHING_RULE };
  }
  if (rule.channels?.length && channel && !rule.channels.includes(channel)) {
    return { ok: false, reason: DisqualifiedReason.NO_MATCHING_RULE };
  }
  if (rule.orderTypes?.length && orderType && !rule.orderTypes.includes(orderType)) {
    return { ok: false, reason: DisqualifiedReason.NO_MATCHING_RULE };
  }
  if (rule.creatorId && rule.creatorId !== creatorId) {
    return { ok: false, reason: DisqualifiedReason.NO_MATCHING_RULE };
  }
  if (!ruleTargetsLine(rule, context)) {
    return { ok: false, reason: DisqualifiedReason.NO_MATCHING_RULE };
  }

  if (rule.minLineQuantity != null && Number(quantity ?? 0) < rule.minLineQuantity) {
    return { ok: false, reason: DisqualifiedReason.BELOW_MIN_QUANTITY };
  }

  if (rule.minOrderAmount != null) {
    // The threshold and the reward can look at different things: "5% of the
    // line, on orders over 2000" is a line reward with an order-level gate.
    const measured = basisAmountFor(rule.conditionBasis ?? "ORDER_TOTAL", context);
    if (measured.lessThan(D(rule.minOrderAmount))) {
      return { ok: false, reason: DisqualifiedReason.BELOW_MIN_ORDER };
    }
  }

  // A rule whose campaign budget is spent stops paying rather than going
  // overdrawn, and says so.
  if (rule.totalBudget != null && D(rule.budgetSpent).greaterThanOrEqualTo(D(rule.totalBudget))) {
    return { ok: false, reason: DisqualifiedReason.BUDGET_EXHAUSTED };
  }

  return { ok: true };
}

/**
 * What a rule pays on this line, before any caps outside the rule itself.
 *
 * A percentage is capped by `maxRewardAmount` when set — the guard that stops
 * "10% of the order total" quietly paying thousands on a catering order.
 */
export function computeReward(rule, context) {
  const basis = rule.basis ?? "ATTRIBUTED_LINE";
  const basisAmount = basisAmountFor(basis, context);

  let amount =
    rule.rewardType === "FIXED"
      ? D(rule.rewardValue)
      : basisAmount.times(D(rule.rewardValue)).dividedBy(100);

  if (rule.maxRewardAmount != null) {
    amount = Prisma.Decimal.min(amount, D(rule.maxRewardAmount));
  }
  if (rule.maxPayoutPerOrder != null) {
    amount = Prisma.Decimal.min(amount, D(rule.maxPayoutPerOrder));
  }

  // Never more than what is left in the campaign budget.
  if (rule.totalBudget != null) {
    const remaining = Prisma.Decimal.max(D(rule.totalBudget).minus(D(rule.budgetSpent)), ZERO);
    amount = Prisma.Decimal.min(amount, remaining);
  }

  return {
    basis,
    basisAmount: money(basisAmount),
    amount: money(Prisma.Decimal.max(amount, ZERO)),
  };
}

/**
 * Picks the one rule that applies, and works out what it pays.
 *
 * Every candidate is evaluated so the *best* reason can be reported when none
 * qualifies: "the order was below the minimum" is useful, "no rule matched" is
 * not, and a creator who sees the second when the first is true will conclude
 * the program is broken.
 */
export function resolveCommission({ rules = [], context }) {
  if (context.isSelfPurchase && !context.allowSelfPurchaseEarning) {
    return { rule: null, amount: money(0), reason: DisqualifiedReason.SELF_PURCHASE };
  }
  if (context.creatorStatus && context.creatorStatus !== "ACTIVE") {
    return { rule: null, amount: money(0), reason: DisqualifiedReason.CREATOR_NOT_ACTIVE };
  }

  const qualified = [];
  const nearMisses = [];

  for (const rule of rules) {
    const verdict = ruleQualifies(rule, context);
    if (verdict.ok) qualified.push(rule);
    else nearMisses.push(verdict.reason);
  }

  if (!qualified.length) {
    // The most informative near-miss wins: a threshold the buyer nearly met
    // tells the creator something, "no rule matched" does not.
    const ranked = [
      DisqualifiedReason.BELOW_MIN_ORDER,
      DisqualifiedReason.BELOW_MIN_QUANTITY,
      DisqualifiedReason.BUDGET_EXHAUSTED,
      DisqualifiedReason.NO_MATCHING_RULE,
    ];
    const reason = ranked.find((candidate) => nearMisses.includes(candidate)) ?? DisqualifiedReason.NO_MATCHING_RULE;

    return { rule: null, amount: money(0), reason };
  }

  const winner = [...qualified].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;

    const specificity = specificityOf(b) - specificityOf(a);
    if (specificity !== 0) return specificity;

    // Deterministic last resort, so the same order always resolves the same way.
    const created = new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0);
    if (created !== 0) return created;
    return String(a.id).localeCompare(String(b.id));
  })[0];

  const reward = computeReward(winner, context);

  if (D(reward.amount).lessThanOrEqualTo(0)) {
    return {
      rule: winner,
      amount: money(0),
      basis: reward.basis,
      basisAmount: reward.basisAmount,
      reason: D(winner.totalBudget ?? 0).greaterThan(0) ? DisqualifiedReason.BUDGET_EXHAUSTED : DisqualifiedReason.ZERO_REWARD,
    };
  }

  return { rule: winner, ...reward, reason: null };
}

/**
 * Applies the caps that sit outside any single rule.
 *
 * Per-order and per-month ceilings are program-wide guards against a runaway
 * payout — a viral video on an expensive catering order, or a creator who has
 * discovered something the rules did not anticipate. Applied after resolution
 * so the earning still records which rule *would* have paid, and how much was
 * trimmed.
 */
export function applyProgramCaps({ amount, orderPaidSoFar = 0, monthPaidSoFar = 0, maxPerOrder, maxPerMonth }) {
  let capped = D(amount);
  let reason = null;

  if (maxPerOrder != null) {
    const remaining = Prisma.Decimal.max(D(maxPerOrder).minus(D(orderPaidSoFar)), ZERO);
    if (capped.greaterThan(remaining)) {
      capped = remaining;
      reason = DisqualifiedReason.ORDER_CAP_REACHED;
    }
  }

  if (maxPerMonth != null) {
    const remaining = Prisma.Decimal.max(D(maxPerMonth).minus(D(monthPaidSoFar)), ZERO);
    if (capped.greaterThan(remaining)) {
      capped = remaining;
      reason = DisqualifiedReason.MONTHLY_CAP_REACHED;
    }
  }

  return { amount: money(capped), capped: reason != null, reason: capped.isZero() ? reason : null };
}
