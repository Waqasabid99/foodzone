import { prisma } from "@/lib/prisma";
import { branchFilter } from "@/server/access/scope";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { getProvider } from "@/server/payments/providers";
import { refundability } from "@/server/payments/refund-window";
import { resolveProviderConfig } from "@/server/services/payment-provider.service";
import { syncOrderPaymentState } from "@/server/services/payment.service";
import { money } from "@/server/pricing/engine";
import { enqueue } from "@/server/jobs/outbox";

/**
 * Refunds.
 *
 * Money leaving the business, so the shape of this module is governed by one
 * question: who decided, and can it be proved afterwards. Hence the four-step
 * lifecycle rather than a single "refund" call —
 *
 *   REQUESTED -> APPROVED -> PROCESSING -> COMPLETED
 *                        \-> REJECTED        \-> FAILED
 *
 * Requesting and approving are **separate permissions**, so the person who
 * fields the complaint is not necessarily the person who authorises the money.
 * A restaurant that wants one-step refunds gives one role both permissions;
 * one that wants a manager in the loop does not. That is a policy choice, and
 * it belongs in role configuration rather than in this code.
 *
 * Amounts are capped against what that payment actually captured, minus what
 * has already gone back — checked at approval *and* enforced by the write, so
 * two half-refunds approved concurrently cannot together exceed the payment.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

/**
 * Whether the gateway will still take this one, and for how much longer.
 *
 * Read from the provider rather than hardcoded, because the window is a fact
 * about that gateway: Safepay stops at 90 days, cash never does, and the next
 * one will be different again.
 */
export function refundWindowFor(payment) {
  let maxAgeDays = null;
  try {
    maxAgeDays = getProvider(payment?.provider).refundMaxAgeDays ?? null;
  } catch {
    // A payment taken through a provider that is no longer registered. Not a
    // reason to block sending somebody their money back.
    maxAgeDays = null;
  }

  return refundability({ capturedAt: payment?.capturedAt ?? null, maxAgeDays });
}

const SELECT = {
  id: true,
  paymentId: true,
  orderId: true,
  amount: true,
  reason: true,
  status: true,
  providerRefundId: true,
  requestedById: true,
  approvedById: true,
  approvedAt: true,
  processedAt: true,
  failureMessage: true,
  createdAt: true,
};

/** A refund can only ever come out of money that was actually taken. */
async function loadRefundablePayment(paymentId) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      orderId: true,
      branchId: true,
      method: true,
      provider: true,
      status: true,
      amount: true,
      refundedAmount: true,
      currency: true,
      capturedAt: true,
    },
  });
  if (!payment) throw ApiError.notFound("Payment not found");

  if (!["CAPTURED", "PARTIALLY_REFUNDED"].includes(payment.status)) {
    throw ApiError.conflict(`A ${payment.status.toLowerCase()} payment cannot be refunded`, {
      status: payment.status,
      hint: payment.status === "AUTHORIZED" ? "Void it instead" : undefined,
    });
  }

  return payment;
}

/**
 * What is left to give back on a payment.
 *
 * Counts refunds that are still in flight as well as completed ones. A refund
 * sitting in PROCESSING has been sent to the gateway; ignoring it here would
 * let a second request be approved for money that is already on its way.
 */
async function refundableAmount(payment) {
  const inFlight = await prisma.refund.aggregate({
    where: { paymentId: payment.id, status: { in: ["REQUESTED", "APPROVED", "PROCESSING", "COMPLETED"] } },
    _sum: { amount: true },
  });

  return Prisma.Decimal.max(D(payment.amount).minus(D(inFlight._sum.amount)), 0);
}

export async function requestRefund({ paymentId, amount = null, reason, actor = null }) {
  if (!reason?.trim()) {
    throw ApiError.validation("A reason is required for a refund", { reason: ["Required"] });
  }

  const payment = await loadRefundablePayment(paymentId);
  const available = await refundableAmount(payment);

  if (available.lessThanOrEqualTo(0)) {
    throw ApiError.conflict("This payment has already been fully refunded");
  }

  // Refused at the point of asking as well as at approval. Raising a refund
  // that can never be approved just leaves a row somebody has to explain to
  // the customer later.
  const window = refundWindowFor(payment);
  if (!window.allowed) {
    throw ApiError.conflict(`This payment can no longer be refunded through ${payment.provider}. ${window.reason}.`, {
      lapsedAt: window.lapsesAt?.toISOString() ?? null,
      settleAnotherWay: "Pay the customer back in cash or by transfer, and record it as an expense so the books still balance",
    });
  }

  const requested = amount == null ? available : money(amount);
  if (D(requested).lessThanOrEqualTo(0)) {
    throw ApiError.validation("A refund must be more than zero", { amount: ["Must be greater than zero"] });
  }
  if (D(requested).greaterThan(available)) {
    throw ApiError.validation("That is more than remains on this payment", {
      amount: [`The most that can be refunded is ${available}`],
    });
  }

  return prisma.refund.create({
    data: {
      paymentId,
      orderId: payment.orderId,
      amount: requested,
      reason: reason.trim(),
      status: "REQUESTED",
      requestedById: actor?.userId ?? null,
    },
    select: SELECT,
  });
}

export async function rejectRefund({ refundId, reason = null, actor = null }) {
  const refund = await prisma.refund.findUnique({ where: { id: refundId }, select: SELECT });
  if (!refund) throw ApiError.notFound("Refund not found");

  if (refund.status !== "REQUESTED") {
    throw ApiError.conflict(`A ${refund.status.toLowerCase()} refund cannot be rejected`, { status: refund.status });
  }

  const updated = await prisma.refund.update({
    where: { id: refundId },
    data: { status: "REJECTED", approvedById: actor?.userId ?? null, approvedAt: new Date(), failureMessage: reason },
    select: SELECT,
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "refund.reject",
    entityType: "Refund",
    entityId: refundId,
    changes: { amount: Number(refund.amount), reason },
  });

  return updated;
}

/**
 * Which drawer a cash refund comes out of.
 *
 * The till the sale was rung on, while it is still open: the notes are
 * physically in that drawer, and taking them from anywhere else leaves two
 * tills wrong — the one that sold closes over, the one that paid closes short.
 * Picking the most recently opened session did exactly that as soon as a second
 * register was running.
 *
 * Once that session is closed its cash is counted and gone, so the money comes
 * from wherever the person handing it over is standing: their own open drawer,
 * or the branch's only open one. With several open and no way to tell, nothing
 * is guessed — a movement in an arbitrary till is worse than none, because it
 * reads as a real count.
 */
async function drawerToRefundFrom(tx, refund, actor) {
  const open = (where) => tx.cashRegisterSession.findFirst({ where: { ...where, status: "OPEN" }, select: { id: true } });

  const original = refund.payment.registerSessionId
    ? await open({ id: refund.payment.registerSessionId })
    : null;
  if (original) return original;

  const branchId = refund.payment.branchId;
  const mine = actor?.userId ? await open({ branchId, openedById: actor.userId }) : null;
  if (mine) return mine;

  const atBranch = await tx.cashRegisterSession.findMany({
    where: { branchId, status: "OPEN" },
    select: { id: true },
    take: 2,
  });
  return atBranch.length === 1 ? atBranch[0] : null;
}

/**
 * Approves a refund and sends it to the provider.
 *
 * The provider call sits **between** two transactions rather than inside one.
 * Holding a database transaction open across a network call to a gateway is how
 * a slow acquirer turns into a table full of stuck locks; and the row is moved
 * to PROCESSING first, so a crash mid-call leaves a refund that is visibly
 * in-flight rather than one that looks untouched and gets sent twice.
 */
export async function approveRefund({ refundId, actor = null, context = {} }) {
  const refund = await prisma.refund.findUnique({
    where: { id: refundId },
    select: {
      ...SELECT,
      payment: {
        select: {
          id: true, provider: true, method: true, amount: true, status: true,
          refundedAmount: true, branchId: true, registerSessionId: true, capturedAt: true,
        },
      },
    },
  });
  if (!refund) throw ApiError.notFound("Refund not found");

  if (refund.status === "COMPLETED") return refund;
  if (!["REQUESTED", "APPROVED", "FAILED"].includes(refund.status)) {
    throw ApiError.conflict(`A ${refund.status.toLowerCase()} refund cannot be approved`, { status: refund.status });
  }

  // Re-checked at approval: the request may have been raised hours ago, and
  // another refund may have been paid out in between.
  const available = await refundableAmount(refund.payment);
  const stillAvailable = available.plus(
    // This refund's own amount is already counted in `available`, so add it back.
    ["REQUESTED", "APPROVED", "PROCESSING"].includes(refund.status) ? D(refund.amount) : 0,
  );
  if (D(refund.amount).greaterThan(stillAvailable)) {
    throw ApiError.conflict("Other refunds have used up this payment since the request was raised", {
      requested: Number(refund.amount),
      available: Number(stillAvailable),
    });
  }

  /*
   * Checked here rather than only at request time: a refund raised inside the
   * window can sit awaiting approval until it is outside one. Refusing before
   * the row is marked PROCESSING means nothing is left half-done, and the
   * message carries the date so whoever reads it knows this is a hard limit
   * at the gateway rather than a rule of ours.
   */
  const window = refundWindowFor(refund.payment);
  if (!window.allowed) {
    throw ApiError.conflict(`This payment can no longer be refunded through ${refund.payment.provider}. ${window.reason}.`, {
      lapsedAt: window.lapsesAt?.toISOString() ?? null,
      settleAnotherWay: "Pay the customer back in cash or by transfer, and record it as an expense so the books still balance",
    });
  }

  await prisma.refund.update({
    where: { id: refundId },
    data: { status: "PROCESSING", approvedById: actor?.userId ?? null, approvedAt: new Date() },
  });

  const adapter = getProvider(refund.payment.provider);

  let result;
  try {
    // Refunding money a gateway already took must keep working after that
    // gateway has been switched off for new sales.
    const { config, mode } = await resolveProviderConfig({
      branchId: refund.payment.branchId,
      provider: refund.payment.provider,
      requireEnabled: false,
    });
    result = await adapter.refund({ payment: refund.payment, refund, config, mode });
  } catch (error) {
    const failed = await prisma.refund.update({
      where: { id: refundId },
      data: { status: "FAILED", failureMessage: error.message?.slice(0, 500) ?? "Provider error" },
      select: SELECT,
    });
    // Left as FAILED and retryable rather than rolled back to REQUESTED: an
    // approval that reached the gateway may still settle, and re-approving is a
    // decision for a human who can check.
    return failed;
  }

  const completed = await withTransaction(async (tx) => {
    const row = await tx.refund.update({
      where: { id: refundId },
      data: {
        status: result.status ?? "COMPLETED",
        providerRefundId: result.providerRefundId ?? null,
        processedAt: new Date(),
        rawResponse: result.raw ?? undefined,
      },
      select: SELECT,
    });

    const totalRefunded = await tx.refund.aggregate({
      where: { paymentId: refund.paymentId, status: "COMPLETED" },
      _sum: { amount: true },
    });
    const refunded = D(totalRefunded._sum.amount);

    await tx.payment.update({
      where: { id: refund.paymentId },
      data: {
        refundedAmount: refunded,
        status: refunded.greaterThanOrEqualTo(D(refund.payment.amount)) ? "REFUNDED" : "PARTIALLY_REFUNDED",
      },
    });

    // Cash out of the drawer is a movement, so the till still reconciles.
    if (["CASH", "CASH_ON_DELIVERY"].includes(refund.payment.method)) {
      const session = await drawerToRefundFrom(tx, refund, actor);
      if (session) {
        await tx.cashMovement.create({
          data: {
            sessionId: session.id,
            type: "REFUND",
            // Negative: money leaving the drawer.
            amount: D(refund.amount).negated(),
            referenceType: "ORDER",
            referenceId: refund.orderId,
            performedById: actor?.userId ?? null,
            reason: refund.reason,
          },
        });
      }
    }

    await syncOrderPaymentState(tx, refund.orderId);
    return row;
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: refund.payment.branchId,
    action: "refund.approve",
    entityType: "Refund",
    entityId: refundId,
    changes: { amount: Number(refund.amount), reason: refund.reason, paymentId: refund.paymentId },
    ipAddress: context.ipAddress ?? null,
    userAgent: context.userAgent ?? null,
  });

  await enqueue({ eventType: "refund.completed", payload: { refundId, orderId: refund.orderId } });

  return completed;
}

export async function listRefunds({ status, orderId, branchId, scope = null, limit = 20, cursor } = {}) {
  // A refund has no branch column; it is scoped through the payment it
  // reverses, which is the only place the money's outlet is recorded.
  const filter = branchFilter(scope);
  const rows = await prisma.refund.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(orderId ? { orderId } : {}),
      ...(filter ? { AND: [{ payment: { branchId: filter } }] } : {}),
      ...(branchId ? { payment: { branchId } } : {}),
    },
    select: {
      ...SELECT,
      order: { select: { orderNumber: true, grandTotal: true } },
      payment: { select: { method: true, provider: true, amount: true } },
    },
    orderBy: { createdAt: "desc" },
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

export async function getRefund(id) {
  const refund = await prisma.refund.findUnique({
    where: { id },
    select: {
      ...SELECT,
      order: { select: { id: true, orderNumber: true, grandTotal: true, paymentState: true } },
      payment: { select: { id: true, method: true, provider: true, amount: true, status: true } },
    },
  });
  if (!refund) throw ApiError.notFound("Refund not found");
  return refund;
}
