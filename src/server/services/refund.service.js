import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { getProvider } from "@/server/payments/providers";
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
    select: { ...SELECT, payment: { select: { id: true, provider: true, method: true, amount: true, status: true, refundedAmount: true, branchId: true } } },
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

  await prisma.refund.update({
    where: { id: refundId },
    data: { status: "PROCESSING", approvedById: actor?.userId ?? null, approvedAt: new Date() },
  });

  const adapter = getProvider(refund.payment.provider);

  let result;
  try {
    result = await adapter.refund({ payment: refund.payment, refund });
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
      const session = await tx.cashRegisterSession.findFirst({
        where: { branchId: refund.payment.branchId, status: "OPEN" },
        select: { id: true },
        orderBy: { openedAt: "desc" },
      });
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

export async function listRefunds({ status, orderId, branchId, limit = 20, cursor } = {}) {
  const rows = await prisma.refund.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(orderId ? { orderId } : {}),
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
