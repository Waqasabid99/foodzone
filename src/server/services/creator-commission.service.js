import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { money } from "@/server/accounting/balance";
import { resolveCommission, specificityOf } from "@/server/creator/rules";

/**
 * Commission rules.
 *
 * The arithmetic and the resolution order live in `@/server/creator/rules`;
 * this is CRUD plus the two things that need a database:
 *
 *   * **A simulator.** Rules interact, exactly one wins, and an admin writing
 *     the fourth overlapping campaign cannot hold that in their head. `simulate`
 *     answers "what would this order pay, and which rule wins" before anybody
 *     is paid the wrong amount.
 *   * **Deletion guards.** A rule that has paid earnings is the explanation for
 *     money already given out. It is deactivated, not deleted.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const SELECT = {
  id: true,
  name: true,
  description: true,
  rewardType: true,
  rewardValue: true,
  basis: true,
  maxRewardAmount: true,
  conditionBasis: true,
  minOrderAmount: true,
  minLineQuantity: true,
  branchIds: true,
  channels: true,
  orderTypes: true,
  creatorId: true,
  priority: true,
  startsAt: true,
  endsAt: true,
  isActive: true,
  maxPayoutPerOrder: true,
  totalBudget: true,
  budgetSpent: true,
  createdAt: true,
  updatedAt: true,
  creator: { select: { id: true, handle: true, displayName: true } },
  targets: { select: { id: true, targetType: true, targetId: true, isExcluded: true } },
  _count: { select: { earnings: true } },
};

function shape(rule) {
  const { _count, ...row } = rule;

  return {
    ...row,
    earningCount: _count?.earnings ?? 0,
    specificity: specificityOf(row),
    budgetRemaining: row.totalBudget != null ? money(D(row.totalBudget).minus(D(row.budgetSpent))) : null,
  };
}

/** Refuses a rule that could never pay anything. */
function assertCoherent(data) {
  if (data.rewardType === "PERCENTAGE" && (D(data.rewardValue).lessThanOrEqualTo(0) || D(data.rewardValue).greaterThan(100))) {
    throw ApiError.validation("A percentage reward is between 0 and 100", {
      rewardValue: [`${data.rewardValue} is not a percentage`],
    });
  }
  if (data.rewardType === "FIXED" && D(data.rewardValue).lessThanOrEqualTo(0)) {
    throw ApiError.validation("A fixed reward has to be more than nothing", {
      rewardValue: ["Must be greater than zero"],
    });
  }
  if (data.startsAt && data.endsAt && new Date(data.startsAt) >= new Date(data.endsAt)) {
    throw ApiError.validation("The rule ends before it starts", { endsAt: ["Must be after the start"] });
  }
  if (data.maxRewardAmount != null && D(data.maxRewardAmount).lessThanOrEqualTo(0)) {
    throw ApiError.validation("A reward ceiling of zero would pay nothing", {
      maxRewardAmount: ["Leave it unset for no ceiling"],
    });
  }
  if (data.totalBudget != null && D(data.totalBudget).lessThanOrEqualTo(0)) {
    throw ApiError.validation("A budget of zero would pay nothing", { totalBudget: ["Leave it unset for no budget"] });
  }
  // A fixed reward measured against the order total is a modelling mistake: the
  // basis is only used for percentages and thresholds, and setting it here
  // suggests an intent the engine will not honour.
  if (data.rewardType === "FIXED" && data.basis && data.basis !== "ATTRIBUTED_LINE") {
    throw ApiError.validation("A fixed reward does not vary with a basis", {
      basis: ["Use ATTRIBUTED_LINE, or switch to a percentage"],
    });
  }
}

export async function createRule(data, actor) {
  assertCoherent(data);

  if (data.creatorId) {
    const creator = await prisma.creatorProfile.findUnique({ where: { id: data.creatorId }, select: { id: true } });
    if (!creator) throw ApiError.validation("Creator not found", { creatorId: ["No such creator"] });
  }

  const rule = await withTransaction(async (tx) =>
    tx.creatorCommissionRule.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        rewardType: data.rewardType ?? "PERCENTAGE",
        rewardValue: money(data.rewardValue),
        basis: data.basis ?? "ATTRIBUTED_LINE",
        maxRewardAmount: data.maxRewardAmount != null ? money(data.maxRewardAmount) : null,
        conditionBasis: data.conditionBasis ?? "ORDER_TOTAL",
        minOrderAmount: data.minOrderAmount != null ? money(data.minOrderAmount) : null,
        minLineQuantity: data.minLineQuantity ?? null,
        branchIds: data.branchIds ?? [],
        channels: data.channels ?? [],
        orderTypes: data.orderTypes ?? [],
        creatorId: data.creatorId ?? null,
        priority: data.priority ?? 0,
        startsAt: data.startsAt ?? null,
        endsAt: data.endsAt ?? null,
        isActive: data.isActive ?? true,
        maxPayoutPerOrder: data.maxPayoutPerOrder != null ? money(data.maxPayoutPerOrder) : null,
        totalBudget: data.totalBudget != null ? money(data.totalBudget) : null,
        createdById: actor?.userId ?? null,
        targets: data.targets?.length
          ? {
              create: data.targets.map((target) => ({
                targetType: target.targetType,
                targetId: target.targetId,
                isExcluded: target.isExcluded ?? false,
              })),
            }
          : undefined,
      },
      select: SELECT,
    }),
  );

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "creator_commission_rule.create",
    entityType: "CreatorCommissionRule",
    entityId: rule.id,
    changes: { name: rule.name, rewardType: rule.rewardType, rewardValue: Number(rule.rewardValue) },
  });

  return shape(rule);
}

async function loadRule(id) {
  const rule = await prisma.creatorCommissionRule.findUnique({ where: { id }, select: SELECT });
  if (!rule) throw ApiError.notFound("Commission rule not found");
  return rule;
}

export async function getRule(id) {
  return shape(await loadRule(id));
}

/**
 * Edits a rule.
 *
 * Editing a rule that has already paid is allowed — campaigns get corrected —
 * because earnings snapshot the values they were paid under. History cannot be
 * rewritten by this, which is exactly why the snapshot exists.
 */
export async function updateRule(id, data, actor) {
  const rule = await loadRule(id);
  assertCoherent({ ...rule, ...data });

  const updated = await withTransaction(async (tx) => {
    if (data.targets) {
      await tx.creatorCommissionRuleTarget.deleteMany({ where: { ruleId: id } });
      if (data.targets.length) {
        await tx.creatorCommissionRuleTarget.createMany({
          data: data.targets.map((target) => ({
            ruleId: id,
            targetType: target.targetType,
            targetId: target.targetId,
            isExcluded: target.isExcluded ?? false,
          })),
        });
      }
    }

    return tx.creatorCommissionRule.update({
      where: { id },
      data: {
        ...(data.name != null ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.rewardType != null ? { rewardType: data.rewardType } : {}),
        ...(data.rewardValue != null ? { rewardValue: money(data.rewardValue) } : {}),
        ...(data.basis != null ? { basis: data.basis } : {}),
        ...(data.maxRewardAmount !== undefined
          ? { maxRewardAmount: data.maxRewardAmount != null ? money(data.maxRewardAmount) : null }
          : {}),
        ...(data.conditionBasis != null ? { conditionBasis: data.conditionBasis } : {}),
        ...(data.minOrderAmount !== undefined
          ? { minOrderAmount: data.minOrderAmount != null ? money(data.minOrderAmount) : null }
          : {}),
        ...(data.minLineQuantity !== undefined ? { minLineQuantity: data.minLineQuantity } : {}),
        ...(data.branchIds ? { branchIds: data.branchIds } : {}),
        ...(data.channels ? { channels: data.channels } : {}),
        ...(data.orderTypes ? { orderTypes: data.orderTypes } : {}),
        ...(data.creatorId !== undefined ? { creatorId: data.creatorId } : {}),
        ...(data.priority != null ? { priority: data.priority } : {}),
        ...(data.startsAt !== undefined ? { startsAt: data.startsAt } : {}),
        ...(data.endsAt !== undefined ? { endsAt: data.endsAt } : {}),
        ...(data.isActive != null ? { isActive: data.isActive } : {}),
        ...(data.maxPayoutPerOrder !== undefined
          ? { maxPayoutPerOrder: data.maxPayoutPerOrder != null ? money(data.maxPayoutPerOrder) : null }
          : {}),
        ...(data.totalBudget !== undefined
          ? { totalBudget: data.totalBudget != null ? money(data.totalBudget) : null }
          : {}),
      },
      select: SELECT,
    });
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "creator_commission_rule.update",
    entityType: "CreatorCommissionRule",
    entityId: id,
    changes: { name: updated.name, fields: Object.keys(data) },
  });

  return shape(updated);
}

/** A rule that has paid is deactivated, never deleted — it explains the money. */
export async function deleteRule(id, actor) {
  const rule = await loadRule(id);

  const earnings = await prisma.creatorEarning.count({ where: { ruleId: id } });
  if (earnings > 0) {
    throw ApiError.conflict(`This rule has paid ${earnings} earning(s)`, {
      hint: "Deactivate it instead — it is the explanation for money already paid",
    });
  }

  await prisma.creatorCommissionRule.delete({ where: { id } });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "creator_commission_rule.delete",
    entityType: "CreatorCommissionRule",
    entityId: id,
    changes: { name: rule.name },
  });

  return { id, deleted: true };
}

export async function listRules({ isActive, creatorId, limit = 20, cursor } = {}) {
  const rows = await prisma.creatorCommissionRule.findMany({
    where: { ...(isActive != null ? { isActive } : {}), ...(creatorId ? { creatorId } : {}) },
    select: SELECT,
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);
  return { ...page, items: page.items.map(shape) };
}

/**
 * What would this sale pay, and which rule would win.
 *
 * The tool that stops an admin discovering the interaction between four
 * overlapping campaigns by underpaying somebody. Every candidate is returned
 * with whether it qualified, not just the winner — "why did the rule I wrote
 * not apply" is the question this has to answer.
 */
export async function simulate({ productId, categoryId, lineAmount, orderSubtotal, orderTotal, quantity = 1, branchId, channel, orderType, creatorId, at = new Date() }) {
  const rules = await prisma.creatorCommissionRule.findMany({
    where: { isActive: true },
    select: SELECT,
  });

  const context = {
    at,
    productId,
    categoryId,
    lineAmount,
    orderSubtotal: orderSubtotal ?? lineAmount,
    orderTotal: orderTotal ?? lineAmount,
    quantity,
    branchId,
    channel,
    orderType,
    creatorId,
    creatorStatus: "ACTIVE",
  };

  const resolved = resolveCommission({ rules, context });

  const { ruleQualifies } = await import("@/server/creator/rules");

  return {
    context,
    winner: resolved.rule ? { id: resolved.rule.id, name: resolved.rule.name } : null,
    amount: resolved.amount,
    basis: resolved.basis ?? null,
    basisAmount: resolved.basisAmount ?? null,
    reason: resolved.reason,
    candidates: rules.map((rule) => {
      const verdict = ruleQualifies(rule, context);
      return {
        id: rule.id,
        name: rule.name,
        priority: rule.priority,
        specificity: specificityOf(rule),
        qualifies: verdict.ok,
        reason: verdict.ok ? null : verdict.reason,
        isWinner: resolved.rule?.id === rule.id,
      };
    }),
  };
}
