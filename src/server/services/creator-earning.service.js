import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { logger } from "@/lib/logger";
import { enqueue } from "@/server/jobs/outbox";
import { money } from "@/server/accounting/balance";
import { DisqualifiedReason, applyProgramCaps, disqualifiedMessage, resolveCommission } from "@/server/creator/rules";
import { programConfig } from "@/server/services/creator.service";
import { creditEarning, reverseEarningCredit } from "@/server/services/creator-wallet.service";

/**
 * The earnings engine.
 *
 * Runs when an order completes, once per attributed line. Four properties
 * matter more than the arithmetic, which lives in `@/server/creator/rules`:
 *
 *   * **A sale that earns nothing still produces a row.** `NOT_QUALIFIED`
 *     records exist so a creator's dashboard can say "your video drove this
 *     sale but it missed the threshold" instead of showing silence. Silence is
 *     indistinguishable from the program being broken.
 *   * **Earnings hold before they credit.** The money is store credit against a
 *     sale that can still be refunded, so it sits `PENDING` through the refund
 *     window and only then becomes spendable.
 *   * **Everything is snapshotted.** The rule name, type, value and basis are
 *     copied onto the earning. Editing a rule next month must not silently
 *     rewrite what somebody was already paid.
 *   * **It is idempotent per (order, video).** A redelivered completion event
 *     must not pay twice, and the unique constraint is what guarantees it
 *     rather than a check that could race.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const SELECT = {
  id: true,
  creatorId: true,
  videoId: true,
  orderId: true,
  attributionId: true,
  ruleId: true,
  status: true,
  ruleNameSnapshot: true,
  rewardType: true,
  rewardValue: true,
  basis: true,
  basisAmount: true,
  amount: true,
  currency: true,
  disqualifiedReason: true,
  orderCompletedAt: true,
  availableAt: true,
  creditedAt: true,
  reversedAt: true,
  reversalReason: true,
  createdAt: true,
  creator: { select: { id: true, handle: true, displayName: true } },
  video: { select: { id: true, caption: true, thumbnailUrl: true, productId: true } },
  order: { select: { id: true, orderNumber: true, grandTotal: true, completedAt: true } },
  rule: { select: { id: true, name: true } },
};

/** Rules that could possibly apply, loaded once per order. */
async function candidateRules(tx = prisma) {
  return tx.creatorCommissionRule.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
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
      targets: { select: { targetType: true, targetId: true, isExcluded: true } },
    },
  });
}

/** What a creator has already been paid this calendar month. */
async function paidThisMonth(creatorId, at, tx = prisma) {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));

  const total = await tx.creatorEarning.aggregate({
    where: {
      creatorId,
      status: { in: ["PENDING", "APPROVED", "CREDITED"] },
      createdAt: { gte: start },
    },
    _sum: { amount: true },
  });

  return D(total._sum.amount ?? 0);
}

/**
 * Works out what an order's attributed lines earned.
 *
 * Called from the outbox when an order completes. Safe to call twice: the
 * unique key on `(orderId, videoId)` means a second run finds the rows already
 * there and leaves them alone.
 */
export async function processOrderEarnings({ orderId }) {
  const config = await programConfig();
  if (!config.isEnabled) return { skipped: true, reason: "PROGRAM_DISABLED" };

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      userId: true,
      branchId: true,
      channel: true,
      type: true,
      status: true,
      subtotal: true,
      grandTotal: true,
      currency: true,
      completedAt: true,
      items: { select: { id: true, productId: true, product: { select: { categoryId: true } } } },
    },
  });
  if (!order) return { skipped: true, reason: "ORDER_NOT_FOUND" };

  if (!["COMPLETED", "DELIVERED"].includes(order.status)) {
    return { skipped: true, reason: `NOT_COMPLETE:${order.status}` };
  }

  const attributions = await prisma.creatorOrderAttribution.findMany({
    where: { orderId },
    select: {
      id: true,
      videoId: true,
      creatorId: true,
      productId: true,
      quantity: true,
      lineAmount: true,
      isSelfPurchase: true,
      creator: { select: { id: true, status: true } },
      earning: { select: { id: true } },
    },
  });
  if (!attributions.length) return { skipped: true, reason: "NO_ATTRIBUTIONS", created: 0 };

  const rules = await candidateRules();
  const categoryByProduct = new Map(order.items.map((item) => [item.productId, item.product?.categoryId ?? null]));
  const completedAt = order.completedAt ?? new Date();
  const availableAt = new Date(completedAt.getTime() + config.earningHoldDays * 86_400_000);

  const results = { created: 0, qualified: 0, notQualified: 0, total: D(0) };
  let orderPaidSoFar = D(0);

  for (const attribution of attributions) {
    // Already processed on an earlier delivery of the same event.
    if (attribution.earning) continue;

    const context = {
      at: completedAt,
      productId: attribution.productId,
      variantId: null,
      categoryId: categoryByProduct.get(attribution.productId) ?? null,
      lineAmount: attribution.lineAmount,
      orderSubtotal: order.subtotal,
      orderTotal: order.grandTotal,
      quantity: attribution.quantity,
      branchId: order.branchId,
      channel: order.channel,
      orderType: order.type,
      creatorId: attribution.creatorId,
      creatorStatus: attribution.creator?.status,
      isSelfPurchase: attribution.isSelfPurchase,
      allowSelfPurchaseEarning: config.allowSelfPurchaseEarning,
    };

    const resolved = resolveCommission({ rules, context });

    let amount = D(resolved.amount ?? 0);
    let reason = resolved.reason;

    if (amount.greaterThan(0)) {
      const monthPaid = await paidThisMonth(attribution.creatorId, completedAt);

      const capped = applyProgramCaps({
        amount,
        orderPaidSoFar,
        monthPaidSoFar: monthPaid,
        maxPerOrder: config.maxEarningPerOrder,
        maxPerMonth: config.maxEarningPerCreatorPerMonth,
      });

      amount = D(capped.amount);
      if (capped.reason) reason = capped.reason;
    }

    const qualifies = amount.greaterThan(0);

    try {
      await withTransaction(async (tx) => {
        await tx.creatorEarning.create({
          data: {
            creatorId: attribution.creatorId,
            videoId: attribution.videoId,
            orderId,
            attributionId: attribution.id,
            ruleId: resolved.rule?.id ?? null,
            status: qualifies ? "PENDING" : "NOT_QUALIFIED",
            ruleNameSnapshot: resolved.rule?.name ?? null,
            rewardType: resolved.rule?.rewardType ?? null,
            rewardValue: resolved.rule?.rewardValue ?? null,
            basis: resolved.basis ?? resolved.rule?.basis ?? null,
            basisAmount: money(resolved.basisAmount ?? attribution.lineAmount),
            amount: money(amount),
            currency: order.currency ?? "PKR",
            disqualifiedReason: qualifies ? null : disqualifiedMessage(reason),
            orderCompletedAt: completedAt,
            availableAt: qualifies ? availableAt : null,
          },
        });

        if (qualifies) {
          // Held against the wallet's pending balance, so a creator can see it
          // coming without being able to spend it yet.
          await tx.creatorWallet.updateMany({
            where: { creatorId: attribution.creatorId },
            data: { pendingBalance: { increment: money(amount) } },
          });

          if (resolved.rule?.totalBudget != null) {
            await tx.creatorCommissionRule.update({
              where: { id: resolved.rule.id },
              data: { budgetSpent: { increment: money(amount) } },
            });
          }

          await tx.creatorVideo.update({
            where: { id: attribution.videoId },
            data: { attributedOrderCount: { increment: 1 }, earnedTotal: { increment: money(amount) } },
          });
        } else {
          await tx.creatorVideo.update({
            where: { id: attribution.videoId },
            data: { attributedOrderCount: { increment: 1 } },
          });
        }

        await tx.creatorProfile.update({
          where: { id: attribution.creatorId },
          data: { totalAttributedOrders: { increment: 1 } },
        });
      });
    } catch (error) {
      // The unique key caught a concurrent or redelivered run. Not an error.
      if (error?.code === "P2002") continue;
      throw error;
    }

    results.created += 1;

    if (qualifies) {
      results.qualified += 1;
      results.total = results.total.plus(amount);
      orderPaidSoFar = orderPaidSoFar.plus(amount);
    } else {
      results.notQualified += 1;

      // The sale happened and earned nothing. Saying so is the difference
      // between a program that feels fair and one that feels broken.
      await enqueue({
        eventType: "creator.appreciation",
        payload: {
          creatorId: attribution.creatorId,
          videoId: attribution.videoId,
          orderId,
          type: "SALE_WITHOUT_COMMISSION",
          title: "Your video drove a sale",
          message: disqualifiedMessage(reason),
          metadata: { orderNumber: order.orderNumber, reason },
        },
      });
    }
  }

  logger.info("creator earnings processed", { orderId, ...results, total: Number(results.total) });
  return { ...results, total: money(results.total) };
}

/**
 * Credits earnings whose hold has run out.
 *
 * The scheduled half of the engine. Runs in small batches and per-earning, so
 * one bad row cannot stop the rest of the payout.
 */
export async function creditDueEarnings({ now = new Date(), limit = 200 } = {}) {
  const due = await prisma.creatorEarning.findMany({
    where: { status: { in: ["PENDING", "APPROVED"] }, availableAt: { lte: now }, amount: { gt: 0 } },
    select: { id: true, creatorId: true, amount: true, orderId: true },
    take: limit,
    orderBy: { availableAt: "asc" },
  });

  const results = { credited: 0, failed: [], total: D(0) };

  for (const earning of due) {
    try {
      await creditEarning({ earningId: earning.id });
      results.credited += 1;
      results.total = results.total.plus(D(earning.amount));
    } catch (error) {
      logger.warn("crediting an earning failed", { earningId: earning.id, error: error.message });
      results.failed.push({ earningId: earning.id, error: error.message });
    }
  }

  return { ...results, total: money(results.total) };
}

/**
 * Claws an earning back.
 *
 * Called when the order behind it is refunded or cancelled. A credited earning
 * has already reached a spendable balance, so the wallet is debited — possibly
 * into the negative, which is deliberate: the credit was spent on food that was
 * then refunded, and pretending otherwise would leave the program short.
 */
export async function reverseEarning(earningId, { reason, actor = null }) {
  const earning = await prisma.creatorEarning.findUnique({
    where: { id: earningId },
    select: { id: true, creatorId: true, status: true, amount: true, orderId: true, videoId: true, ruleId: true },
  });
  if (!earning) throw ApiError.notFound("Earning not found");

  if (["REVERSED", "REJECTED", "NOT_QUALIFIED"].includes(earning.status)) {
    return { id: earningId, skipped: true, reason: `ALREADY_${earning.status}` };
  }

  const wasCredited = earning.status === "CREDITED";

  await withTransaction(async (tx) => {
    if (wasCredited) {
      await reverseEarningCredit({ tx, earning, reason });
    } else {
      // Still pending: it never became spendable, so only the pending mirror
      // has to come back off.
      await tx.creatorWallet.updateMany({
        where: { creatorId: earning.creatorId },
        data: { pendingBalance: { decrement: D(earning.amount) } },
      });
    }

    await tx.creatorEarning.update({
      where: { id: earningId },
      data: { status: "REVERSED", reversedAt: new Date(), reversalReason: reason, reviewedById: actor?.userId ?? null },
    });

    await tx.creatorVideo.update({
      where: { id: earning.videoId },
      data: { earnedTotal: { decrement: D(earning.amount) } },
    });

    // Budget the rule no longer spent.
    if (earning.ruleId) {
      await tx.creatorCommissionRule.updateMany({
        where: { id: earning.ruleId },
        data: { budgetSpent: { decrement: D(earning.amount) } },
      });
    }
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "creator_earning.reverse",
    entityType: "CreatorEarning",
    entityId: earningId,
    changes: { amount: Number(earning.amount), reason, wasCredited },
  });

  return { id: earningId, reversed: true, wasCredited };
}

/** Reverses everything an order earned. Used when it is refunded. */
export async function reverseOrderEarnings({ orderId, reason }) {
  const earnings = await prisma.creatorEarning.findMany({
    where: { orderId, status: { in: ["PENDING", "APPROVED", "CREDITED"] } },
    select: { id: true },
  });

  const results = [];
  for (const earning of earnings) {
    results.push(await reverseEarning(earning.id, { reason }));
  }

  return { orderId, reversed: results.filter((row) => row.reversed).length };
}

/** An admin voiding an earning outright — the fraud path. */
export async function rejectEarning(earningId, { reason, actor }) {
  const earning = await prisma.creatorEarning.findUnique({
    where: { id: earningId },
    select: { id: true, status: true, amount: true, creatorId: true },
  });
  if (!earning) throw ApiError.notFound("Earning not found");

  if (earning.status === "CREDITED") {
    throw ApiError.conflict("That earning is already credited", {
      hint: "Reverse it instead, which claws the credit back",
    });
  }

  const rejected = await withTransaction(async (tx) => {
    if (earning.status === "PENDING" || earning.status === "APPROVED") {
      await tx.creatorWallet.updateMany({
        where: { creatorId: earning.creatorId },
        data: { pendingBalance: { decrement: D(earning.amount) } },
      });
    }

    return tx.creatorEarning.update({
      where: { id: earningId },
      data: { status: "REJECTED", disqualifiedReason: reason, reviewedById: actor.userId },
      select: SELECT,
    });
  });

  await recordAudit({
    actorId: actor.userId,
    action: "creator_earning.reject",
    entityType: "CreatorEarning",
    entityId: earningId,
    changes: { amount: Number(earning.amount), reason },
  });

  return rejected;
}

export async function listEarnings({ creatorId, orderId, videoId, status, from, to, limit = 20, cursor } = {}) {
  const rows = await prisma.creatorEarning.findMany({
    where: {
      ...(creatorId ? { creatorId } : {}),
      ...(orderId ? { orderId } : {}),
      ...(videoId ? { videoId } : {}),
      ...(status ? { status } : {}),
      ...(from || to
        ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
    },
    select: SELECT,
    orderBy: { createdAt: "desc" },
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

export async function getEarning(id) {
  const earning = await prisma.creatorEarning.findUnique({ where: { id }, select: SELECT });
  if (!earning) throw ApiError.notFound("Earning not found");
  return earning;
}

/** Program-level totals, for the admin dashboard. */
export async function earningsSummary({ from, to } = {}) {
  const window = from || to
    ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
    : {};

  const grouped = await prisma.creatorEarning.groupBy({
    by: ["status"],
    where: window,
    _sum: { amount: true },
    _count: { _all: true },
  });

  const byStatus = Object.fromEntries(
    grouped.map((row) => [row.status, { count: row._count._all, amount: money(row._sum.amount ?? 0) }]),
  );

  const attributedRevenue = await prisma.creatorOrderAttribution.aggregate({
    where: from || to ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {},
    _sum: { lineAmount: true },
    _count: { _all: true },
  });

  const paid = D(byStatus.CREDITED?.amount ?? 0);
  const revenue = D(attributedRevenue._sum.lineAmount ?? 0);

  return {
    byStatus,
    attributedOrders: attributedRevenue._count._all,
    attributedRevenue: money(revenue),
    creditedTotal: money(paid),
    // What the program costs per unit of revenue it drove — the number that
    // decides whether it continues.
    costOfSalesPercent: revenue.greaterThan(0) ? Number(paid.dividedBy(revenue).times(100).toDecimalPlaces(2)) : 0,
  };
}
