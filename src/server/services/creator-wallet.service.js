import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { logger } from "@/lib/logger";
import { money } from "@/server/accounting/balance";
import { programConfig } from "@/server/services/creator.service";

/**
 * Store credit.
 *
 * An append-only ledger with a cached running total, the same shape as the
 * stock ledger: `CreatorWalletTransaction` is the truth and `CreatorWallet
 * .balance` exists so a checkout does not sum a thousand rows. Every write goes
 * through `post()` — the moment something updates the balance directly, the two
 * disagree and nothing can tell you which is right.
 *
 * The money never leaves as cash. It is spent on orders, which is why
 * redemption is a `Payment` with method `STORE_CREDIT` pointing back at the
 * transaction that funded it.
 *
 * `pendingBalance` mirrors earnings still inside the refund hold. It is shown
 * to the creator and is deliberately **not** spendable: crediting before the
 * refund window closes means paying out on sales that get reversed.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);
const ZERO = D(0);

const WALLET_SELECT = {
  id: true,
  creatorId: true,
  currency: true,
  balance: true,
  pendingBalance: true,
  lifetimeEarned: true,
  lifetimeRedeemed: true,
  lifetimeExpired: true,
  isLocked: true,
  lockReason: true,
  updatedAt: true,
};

const TXN_SELECT = {
  id: true,
  type: true,
  amount: true,
  balanceAfter: true,
  earningId: true,
  orderId: true,
  paymentId: true,
  expiresAt: true,
  note: true,
  createdAt: true,
};

export async function walletFor(creatorId, tx = prisma) {
  const wallet = await tx.creatorWallet.findUnique({ where: { creatorId }, select: WALLET_SELECT });
  if (wallet) return wallet;

  return tx.creatorWallet.create({ data: { creatorId }, select: WALLET_SELECT });
}

/**
 * The single write path.
 *
 * Signed amounts: positive credits the creator, negative spends or claws back.
 * `idempotencyKey` is what makes "credit this earning" and "spend this credit"
 * safe to retry — the unique constraint refuses the second attempt rather than
 * a check that could race with itself.
 */
export async function post(tx, { creatorId, type, amount, earningId = null, orderId = null, paymentId = null, note = null, expiresAt = null, idempotencyKey = null, performedById = null }) {
  const wallet = await walletFor(creatorId, tx);
  const delta = D(amount);

  if (delta.isZero()) return null;

  if (wallet.isLocked && delta.lessThan(0)) {
    throw ApiError.conflict("This wallet is frozen", { reason: wallet.lockReason });
  }

  const balanceAfter = D(wallet.balance).plus(delta);

  // Spending more than the balance is refused; a clawback may go negative, and
  // that is deliberate — the credit was spent on food that was then refunded.
  if (type === "REDEMPTION" && balanceAfter.lessThan(0)) {
    throw ApiError.conflict("Not enough store credit", {
      available: Number(wallet.balance),
      requested: Number(delta.abs()),
    });
  }

  const transaction = await tx.creatorWalletTransaction.create({
    data: {
      walletId: wallet.id,
      type,
      amount: money(delta),
      balanceAfter: money(balanceAfter),
      earningId,
      orderId,
      paymentId,
      expiresAt,
      note,
      idempotencyKey,
      performedById,
    },
    select: TXN_SELECT,
  });

  await tx.creatorWallet.update({
    where: { id: wallet.id },
    data: {
      balance: money(balanceAfter),
      ...(type === "EARNING_CREDIT" ? { lifetimeEarned: { increment: money(delta) } } : {}),
      ...(type === "REDEMPTION" ? { lifetimeRedeemed: { increment: money(delta.abs()) } } : {}),
      ...(type === "EXPIRY" ? { lifetimeExpired: { increment: money(delta.abs()) } } : {}),
    },
  });

  return transaction;
}

/**
 * Moves an earning from pending into spendable credit.
 *
 * Idempotent on the earning: the key means a retry of the credit job finds the
 * transaction already written and leaves the balance alone.
 */
export async function creditEarning({ earningId }) {
  const config = await programConfig();

  const earning = await prisma.creatorEarning.findUnique({
    where: { id: earningId },
    select: { id: true, creatorId: true, amount: true, status: true, orderId: true },
  });
  if (!earning) throw ApiError.notFound("Earning not found");

  if (earning.status === "CREDITED") return { earningId, skipped: true, reason: "ALREADY_CREDITED" };
  if (!["PENDING", "APPROVED"].includes(earning.status)) {
    return { earningId, skipped: true, reason: `NOT_CREDITABLE:${earning.status}` };
  }
  if (D(earning.amount).lessThanOrEqualTo(0)) {
    return { earningId, skipped: true, reason: "ZERO_AMOUNT" };
  }

  const expiresAt = config.creditExpiryDays
    ? new Date(Date.now() + config.creditExpiryDays * 86_400_000)
    : null;

  const result = await withTransaction(async (tx) => {
    const transaction = await post(tx, {
      creatorId: earning.creatorId,
      type: "EARNING_CREDIT",
      amount: earning.amount,
      earningId,
      orderId: earning.orderId,
      expiresAt,
      note: "Earning credited",
      idempotencyKey: `earning:${earningId}`,
    });

    await tx.creatorEarning.update({
      where: { id: earningId },
      data: { status: "CREDITED", creditedAt: new Date() },
    });

    // The pending mirror comes off as the real balance goes on.
    await tx.creatorWallet.updateMany({
      where: { creatorId: earning.creatorId },
      data: { pendingBalance: { decrement: D(earning.amount) } },
    });

    await tx.creatorProfile.update({
      where: { id: earning.creatorId },
      data: { lifetimeEarned: { increment: D(earning.amount) } },
    });

    return transaction;
  });

  logger.info("creator earning credited", { earningId, amount: Number(earning.amount) });
  return { earningId, credited: true, transactionId: result?.id ?? null };
}

/** Claws a credited earning back out of the wallet. */
export async function reverseEarningCredit({ tx, earning, reason }) {
  await post(tx, {
    creatorId: earning.creatorId,
    type: "REVERSAL",
    amount: D(earning.amount).negated(),
    earningId: earning.id,
    orderId: earning.orderId,
    note: reason ?? "Earning reversed",
    idempotencyKey: `earning-reversal:${earning.id}`,
  });

  await tx.creatorProfile.update({
    where: { id: earning.creatorId },
    data: { lifetimeEarned: { decrement: D(earning.amount) } },
  });
}

/**
 * How much credit may be put against an order.
 *
 * Three limits at once — the balance, the program minimum and the per-order
 * percentage cap — and the smallest wins. The cap exists so credit tops orders
 * up rather than replacing them entirely; a program where every order is free
 * is a discount, not a loyalty mechanic.
 */
export async function redeemableFor({ userId, orderTotal }) {
  const config = await programConfig();

  const creator = await prisma.creatorProfile.findUnique({ where: { userId }, select: { id: true, status: true } });
  if (!creator) return { available: money(0), redeemable: money(0), reason: "NOT_A_CREATOR" };

  const wallet = await walletFor(creator.id);

  if (wallet.isLocked) {
    return { available: money(wallet.balance), redeemable: money(0), reason: "WALLET_FROZEN" };
  }

  const balance = D(wallet.balance);
  if (balance.lessThanOrEqualTo(0)) {
    return { available: money(0), redeemable: money(0), reason: "NO_BALANCE" };
  }

  if (D(config.minRedemptionAmount).greaterThan(0) && balance.lessThan(D(config.minRedemptionAmount))) {
    return {
      available: money(balance),
      redeemable: money(0),
      reason: "BELOW_MINIMUM",
      minimum: money(config.minRedemptionAmount),
    };
  }

  const percentCap = D(orderTotal).times(D(config.maxRedemptionPercent)).dividedBy(100);
  const redeemable = Prisma.Decimal.min(balance, percentCap, D(orderTotal));

  return {
    available: money(balance),
    redeemable: money(Prisma.Decimal.max(redeemable, ZERO)),
    maxPercent: Number(config.maxRedemptionPercent),
    reason: null,
  };
}

/**
 * Spends credit on an order.
 *
 * Called from checkout inside the order transaction, so the credit and the
 * order commit together. Keyed on the order, so a retried checkout cannot spend
 * the balance twice.
 */
export async function redeem({ tx, userId, orderId, amount, paymentId = null }) {
  const creator = await tx.creatorProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!creator) throw ApiError.conflict("You have no store credit to spend");

  const requested = D(amount);
  if (requested.lessThanOrEqualTo(0)) return null;

  return post(tx, {
    creatorId: creator.id,
    type: "REDEMPTION",
    amount: requested.negated(),
    orderId,
    paymentId,
    note: "Spent on an order",
    idempotencyKey: `redeem:${orderId}`,
  });
}

/** Returns credit when the order it was spent on is cancelled. */
export async function refundRedemption({ orderId, reason = null }) {
  const spent = await prisma.creatorWalletTransaction.findFirst({
    where: { orderId, type: "REDEMPTION" },
    select: { id: true, amount: true, wallet: { select: { creatorId: true } } },
  });
  if (!spent) return { orderId, refunded: false, reason: "NO_REDEMPTION" };

  const already = await prisma.creatorWalletTransaction.findFirst({
    where: { orderId, type: "REDEMPTION_REVERSAL" },
    select: { id: true },
  });
  if (already) return { orderId, refunded: false, reason: "ALREADY_REFUNDED" };

  await withTransaction(async (tx) => {
    await post(tx, {
      creatorId: spent.wallet.creatorId,
      type: "REDEMPTION_REVERSAL",
      // The redemption was negative; returning it is the same magnitude back.
      amount: D(spent.amount).abs(),
      orderId,
      note: reason ?? "Order cancelled",
      idempotencyKey: `redeem-reversal:${orderId}`,
    });
  });

  return { orderId, refunded: true, amount: money(D(spent.amount).abs()) };
}

/** An admin correcting a balance. Always audited, always with a reason. */
export async function adjustWallet({ creatorId, amount, note, actor }) {
  if (!note) throw ApiError.validation("Say why", { note: ["An adjustment needs a reason"] });

  const transaction = await withTransaction(async (tx) =>
    post(tx, {
      creatorId,
      type: "ADJUSTMENT",
      amount,
      note,
      performedById: actor.userId,
    }),
  );

  await recordAudit({
    actorId: actor.userId,
    action: "creator_wallet.adjust",
    entityType: "CreatorWallet",
    entityId: creatorId,
    changes: { amount: Number(amount), note },
  });

  return transaction;
}

export async function setWalletFrozen({ creatorId, isLocked, reason = null, actor }) {
  const wallet = await walletFor(creatorId);

  const updated = await prisma.creatorWallet.update({
    where: { id: wallet.id },
    data: { isLocked, lockReason: isLocked ? reason : null },
    select: WALLET_SELECT,
  });

  await recordAudit({
    actorId: actor.userId,
    action: isLocked ? "creator_wallet.freeze" : "creator_wallet.unfreeze",
    entityType: "CreatorWallet",
    entityId: wallet.id,
    changes: { creatorId, reason },
  });

  return updated;
}

export async function walletStatement({ creatorId, limit = 50, cursor }) {
  const wallet = await walletFor(creatorId);

  const rows = await prisma.creatorWalletTransaction.findMany({
    where: { walletId: wallet.id },
    select: TXN_SELECT,
    orderBy: { createdAt: "desc" },
    ...cursorArgs(cursor, limit),
  });

  return { wallet, transactions: toPage(rows, limit) };
}

/**
 * Expires credit lots that have run out of time.
 *
 * Only what is actually still there: a creator who spent the credit before it
 * expired owes nothing, and expiring an already-spent lot would take the
 * balance negative for money that was legitimately used.
 */
export async function expireCredit({ now = new Date() } = {}) {
  const lots = await prisma.creatorWalletTransaction.findMany({
    where: { type: "EARNING_CREDIT", expiresAt: { not: null, lte: now } },
    select: { id: true, amount: true, walletId: true, expiresAt: true, wallet: { select: { creatorId: true, balance: true } } },
  });

  const results = { expired: 0, total: D(0) };

  for (const lot of lots) {
    const already = await prisma.creatorWalletTransaction.findFirst({
      where: { type: "EXPIRY", note: `Expired lot ${lot.id}` },
      select: { id: true },
    });
    if (already) continue;

    const balance = D(lot.wallet.balance);
    if (balance.lessThanOrEqualTo(0)) continue;

    // Never expire more than is left.
    const amount = Prisma.Decimal.min(D(lot.amount), balance);
    if (amount.lessThanOrEqualTo(0)) continue;

    await withTransaction(async (tx) => {
      await post(tx, {
        creatorId: lot.wallet.creatorId,
        type: "EXPIRY",
        amount: amount.negated(),
        note: `Expired lot ${lot.id}`,
        idempotencyKey: `expiry:${lot.id}`,
      });
    });

    results.expired += 1;
    results.total = results.total.plus(amount);
  }

  return { ...results, total: money(results.total) };
}

/**
 * Rebuilds the cached balance by replaying the ledger.
 *
 * The safety net that makes "the ledger is the truth" testable rather than a
 * slogan. Drift means something wrote around `post()`.
 */
export async function rebuildBalances({ creatorId = null } = {}) {
  const wallets = await prisma.creatorWallet.findMany({
    where: { ...(creatorId ? { creatorId } : {}) },
    select: { id: true, creatorId: true, balance: true },
  });

  const drift = [];

  for (const wallet of wallets) {
    const total = await prisma.creatorWalletTransaction.aggregate({
      where: { walletId: wallet.id },
      _sum: { amount: true },
    });
    const expected = money(total._sum.amount ?? 0);

    if (!D(wallet.balance).equals(D(expected))) {
      drift.push({ creatorId: wallet.creatorId, cached: Number(wallet.balance), actual: Number(expected) });
      await prisma.creatorWallet.update({ where: { id: wallet.id }, data: { balance: expected } });
    }
  }

  return { checked: wallets.length, corrected: drift.length, drift };
}
