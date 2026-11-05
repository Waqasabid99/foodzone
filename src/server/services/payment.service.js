import { prisma } from "@/lib/prisma";
import { branchFilter } from "@/server/access/scope";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { getProvider } from "@/server/payments/providers";
import { enabledProviders, resolveProviderConfig } from "@/server/services/payment-provider.service";
import { chooseProvider } from "@/server/payments/choose";
import { isProduction } from "@/lib/env";
import { amountDue, derivePaymentState } from "@/server/payments/state";
import { money } from "@/server/pricing/engine";
import { enqueue } from "@/server/jobs/outbox";
import { openSession } from "@/server/services/register.service";

/**
 * Payments.
 *
 * Three rules run through everything here, and each one exists because the
 * alternative loses real money:
 *
 *   * **The client never names an amount.** A charge is "pay order X"; how much
 *     that is comes from the order. A mobile binary is under the user's
 *     control, so a client-supplied amount is a request to choose your own
 *     price.
 *   * **`Order.paymentState` is derived, never assigned.** It summarises the
 *     payment and refund rows, so it is recomputed from them after every write
 *     — see `src/server/payments/state.js`.
 *   * **Charging is idempotent.** A customer on a flaky connection taps pay
 *     twice; a mobile client retries a timed-out request. Without an
 *     idempotency key that second attempt is a second charge, and the customer
 *     finds out from their statement.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const SELECT = {
  id: true,
  orderId: true,
  branchId: true,
  method: true,
  provider: true,
  status: true,
  amount: true,
  currency: true,
  feeAmount: true,
  refundedAmount: true,
  providerOrderId: true,
  providerPaymentId: true,
  idempotencyKey: true,
  cardBrand: true,
  cardLast4: true,
  failureCode: true,
  failureMessage: true,
  collectedById: true,
  registerSessionId: true,
  authorizedAt: true,
  capturedAt: true,
  failedAt: true,
  createdAt: true,
};

/** Methods that are settled by a person rather than an API. */
const MANUAL_METHODS = ["CASH", "CASH_ON_DELIVERY", "BANK_TRANSFER", "AGGREGATOR", "OTHER"];

/**
 * Recomputes the order's payment state from its rows.
 *
 * Called after every write that could change it, inside the same transaction.
 * Returns the new state so callers can report it without a second read.
 */
export async function syncOrderPaymentState(tx, orderId) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      grandTotal: true,
      paymentState: true,
      payments: { select: { status: true, amount: true } },
      refunds: { select: { status: true, amount: true } },
    },
  });
  if (!order) return null;

  const state = derivePaymentState({
    grandTotal: order.grandTotal,
    payments: order.payments,
    refunds: order.refunds,
  });

  if (state !== order.paymentState) {
    await tx.order.update({
      where: { id: orderId },
      data: {
        paymentState: state,
        /*
         * A settled bill is no longer a table waiting to pay. Cleared here
         * rather than by the till screen, because the money can arrive from
         * anywhere — a card terminal's callback, the customer paying on their
         * own phone — and a table left on the "waiting to pay" list after it
         * has paid sends a member of staff to interrupt somebody's dessert.
         */
        ...(state === "PAID" ? { billRequestedAt: null, billRequestedById: null } : {}),
      },
    });
  }

  return state;
}

async function loadOrder(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      branchId: true,
      status: true,
      currency: true,
      grandTotal: true,
      paymentState: true,
      payments: { select: { id: true, status: true, amount: true } },
      refunds: { select: { status: true, amount: true } },
    },
  });
  if (!order) throw ApiError.notFound("Order not found");
  return order;
}

/**
 * Starts a payment against an order.
 *
 * The amount defaults to what is still owed, and may never exceed it. Passing
 * a smaller amount is how a split bill works — four people paying a quarter
 * each is four Payment rows, and the order becomes PAID when they add up.
 */
export async function createPayment({
  orderId,
  method,
  provider = null,
  amount = null,
  idempotencyKey = null,
  returnUrl = null,
  /** Where a hosted gateway sends a customer who backs out. */
  cancelUrl = null,
  actor = null,
  registerSessionId = null,
}) {
  const order = await loadOrder(orderId);

  if (["CANCELLED", "REFUNDED"].includes(order.status)) {
    throw ApiError.conflict(`A ${order.status.toLowerCase()} order cannot be paid`);
  }

  // Replaying the same key returns the original payment rather than making a
  // second one. This is checked before anything else, so a retry is cheap and
  // cannot race past the guards below.
  if (idempotencyKey) {
    const existing = await prisma.payment.findUnique({ where: { idempotencyKey }, select: SELECT });
    if (existing) {
      if (existing.orderId !== orderId) {
        // The same key naming a different order is a client bug, and silently
        // returning the other order's payment would hide it.
        throw ApiError.conflict("That idempotency key was already used for a different order");
      }
      return { payment: existing, replayed: true, clientAction: null };
    }
  }

  const due = amountDue({ grandTotal: order.grandTotal, payments: order.payments, refunds: order.refunds });
  if (due.lessThanOrEqualTo(0)) throw ApiError.conflict("This order is already paid in full");

  const requested = amount == null ? due : money(amount);
  if (D(requested).lessThanOrEqualTo(0)) {
    throw ApiError.validation("A payment must be more than zero", { amount: ["Must be greater than zero"] });
  }
  if (D(requested).greaterThan(due)) {
    throw ApiError.validation("That is more than the order still owes", {
      amount: [`The most that can be charged is ${due}`],
    });
  }

  /*
   * Which gateway takes this. An explicit choice wins; otherwise a manual
   * method goes to cash and an online one goes to whichever gateway this
   * branch has switched on.
   *
   * The enabled list is only looked up when it is actually needed, so a
   * counter cash sale costs no extra query.
   */
  const providerName = chooseProvider({
    requested: provider,
    method,
    enabled: provider || MANUAL_METHODS.includes(method) ? [] : await enabledProviders({ branchId: order.branchId }),
    // The fake gateway's own rule for when it may be used at all, asked once.
    allowMock: !isProduction() || Boolean(process.env.MOCK_PAYMENT_SECRET),
  });
  const adapter = getProvider(providerName);

  if (adapter.methods?.length && !adapter.methods.includes(method)) {
    throw ApiError.validation(`${providerName} cannot take ${method} payments`, {
      method: [`Supported: ${adapter.methods.join(", ")}`],
    });
  }

  // The row is written *before* the provider is called, so a gateway that
  // charges the customer and then times out still has a local record pointing
  // at it. The opposite order — call, then persist — is how money gets taken
  // for a payment the system has never heard of.
  const payment = await prisma.payment.create({
    data: {
      orderId,
      branchId: order.branchId,
      method,
      provider: providerName,
      status: "PENDING",
      amount: requested,
      currency: order.currency ?? "PKR",
      idempotencyKey,
      registerSessionId,
      collectedById: MANUAL_METHODS.includes(method) ? (actor?.userId ?? null) : null,
    },
    select: SELECT,
  });

  let intent;
  try {
    /*
     * The restaurant's own gateway account, resolved at the moment of the call
     * and held nowhere. Cash resolves to an empty config and needs no row, so
     * a counter sale still works at a branch that has configured nothing.
     */
    const { config, mode } = await resolveProviderConfig({ branchId: order.branchId, provider: providerName });
    intent = await adapter.createIntent({ payment, order, returnUrl, cancelUrl, config, mode });
  } catch (error) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "FAILED", failedAt: new Date(), failureMessage: error.message?.slice(0, 500) ?? "Provider error" },
    });
    throw ApiError.conflict(`The payment provider rejected this charge: ${error.message}`, {
      provider: providerName,
    });
  }

  const updated = await withTransaction(async (tx) => {
    const row = await tx.payment.update({
      where: { id: payment.id },
      data: {
        providerOrderId: intent.providerOrderId ?? null,
        providerPaymentId: intent.providerPaymentId ?? null,
        status: intent.status ?? "PENDING",
        rawResponse: intent.raw ?? undefined,
        ...(intent.status === "AUTHORIZED" ? { authorizedAt: new Date() } : {}),
      },
      select: SELECT,
    });

    await syncOrderPaymentState(tx, orderId);
    return row;
  });

  return { payment: updated, replayed: false, clientAction: intent.clientAction ?? null };
}

/**
 * Captures an authorised gateway payment.
 *
 * Idempotent: capturing an already-captured payment returns it unchanged rather
 * than charging again.
 *
 * Cash-like money is refused here and sent to `markCollected` instead. The two
 * endpoints look interchangeable — same permission set on the Cashier role, one
 * route apart — and they are not: only `markCollected` attaches the money to a
 * register session. Captured this way, an order read PAID with the notes in the
 * drawer and no movement written, so the till closed short by the sale and the
 * cashier wore it. `viaDrawer` is how `markCollected` says it has a drawer in
 * hand; nothing else passes it.
 */
export async function capturePayment({ paymentId, amount = null, actor = null, viaDrawer = false }) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: SELECT });
  if (!payment) throw ApiError.notFound("Payment not found");

  if (!viaDrawer && MANUAL_METHODS.includes(payment.method)) {
    throw ApiError.conflict("Cash-like payments are marked collected, not captured, so they land in a drawer", {
      method: payment.method,
      collectWith: `POST /api/v1/admin/payments/${paymentId}/collect`,
    });
  }

  if (payment.status === "CAPTURED") return { payment, changed: false };

  if (!["PENDING", "AUTHORIZED"].includes(payment.status)) {
    throw ApiError.conflict(`A ${payment.status.toLowerCase()} payment cannot be captured`, {
      status: payment.status,
    });
  }

  const adapter = getProvider(payment.provider);
  const { config, mode } = await resolveProviderConfig({
    branchId: payment.branchId,
    provider: payment.provider,
    // A gateway switched off since the charge was made must still be able to
    // finish settling money it already took.
    requireEnabled: false,
  });
  const result = await adapter.capture({
    payment,
    amount: amount == null ? payment.amount : money(amount),
    config,
    mode,
  });

  const captured = money(result.capturedAmount ?? payment.amount);

  const updated = await withTransaction(async (tx) => {
    const row = await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: "CAPTURED",
        // The gateway's figure wins. It is what actually moved.
        amount: captured,
        feeAmount: result.feeAmount != null ? money(result.feeAmount) : payment.feeAmount,
        providerPaymentId: result.providerPaymentId ?? payment.providerPaymentId,
        capturedAt: new Date(),
        rawResponse: result.raw ?? undefined,
        ...(actor?.userId && MANUAL_METHODS.includes(payment.method) ? { collectedById: actor.userId } : {}),
      },
      select: SELECT,
    });

    await syncOrderPaymentState(tx, payment.orderId);
    return row;
  });

  await enqueue({ eventType: "payment.captured", payload: { paymentId, orderId: payment.orderId } });

  return { payment: updated, changed: true };
}

/**
 * Records cash or COD as collected.
 *
 * Deliberately a different entry point from `capturePayment`, even though it
 * ends in the same place: this one attaches the money to a **register session**,
 * so it can be counted at close. Cash that is captured without landing in a
 * drawer is cash nobody will notice is missing.
 *
 * And if no drawer is open, one is opened here rather than letting the money
 * fall outside every count. That is what a till does in every system that
 * handles cash seriously: the session is bookkeeping, not a ceremony, and a
 * cashier who forgot to start a shift has still taken the money. It opens in
 * their own name with a float of zero, which is the honest figure — nobody
 * counted one — and leaves a note saying so, so the opening count can be
 * corrected with a pay-in rather than silently assumed.
 */
/**
 * Opens a drawer for somebody who is about to take cash without one.
 *
 * Named after the cashier rather than taking the branch's default name: the
 * default may already be open in somebody else's hands, and two people
 * accountable for one drawer is the same as nobody being accountable for it.
 * A name collision is therefore impossible by construction, but a second
 * payment racing the first would still conflict, so a conflict is resolved by
 * reading back the session the other request just opened.
 */
async function openDrawerFor({ branchId, actor }) {
  const registerName = String(actor.name ?? actor.email ?? "Till").slice(0, 40);

  try {
    const session = await openSession({
      branchId,
      registerName,
      openingFloat: 0,
      actor,
      notes: "Opened automatically when cash was taken with no drawer running. The float is zero because nobody counted one — record a pay-in if there was change in the till.",
    });
    return session.id;
  } catch {
    const existing = await prisma.cashRegisterSession.findFirst({
      where: { branchId, registerName, status: "OPEN" },
      select: { id: true },
      orderBy: { openedAt: "desc" },
    });
    return existing?.id ?? null;
  }
}

export async function markCollected({ paymentId, registerSessionId = null, actor = null }) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: SELECT });
  if (!payment) throw ApiError.notFound("Payment not found");

  if (!MANUAL_METHODS.includes(payment.method)) {
    throw ApiError.conflict("Only cash-like payments are marked collected; capture the rest", {
      method: payment.method,
    });
  }

  let sessionId = registerSessionId;
  if (sessionId) {
    const session = await prisma.cashRegisterSession.findFirst({
      where: { id: sessionId, branchId: payment.branchId, status: "OPEN" },
      select: { id: true },
    });
    if (!session) {
      throw ApiError.validation("That register session is not open at this branch", {
        registerSessionId: ["No open session"],
      });
    }
  } else if (payment.method !== "AGGREGATOR") {
    // Fall back to the actor's own open session, so a cashier does not have to
    // name the drawer they are standing at.
    const session = await prisma.cashRegisterSession.findFirst({
      where: { branchId: payment.branchId, status: "OPEN", openedById: actor?.userId ?? "" },
      select: { id: true },
      orderBy: { openedAt: "desc" },
    });
    sessionId = session?.id ?? (actor ? await openDrawerFor({ branchId: payment.branchId, actor }) : null);
  }

  // Already captured *and already in a drawer* is a double tap: nothing to do.
  // Already captured with no drawer is money sitting outside every count —
  // which is what the old capture route produced — so it is adopted here
  // rather than left for a hand-written adjustment to paper over.
  const already = payment.status === "CAPTURED" && payment.registerSessionId != null;
  const result = await capturePayment({ paymentId, actor, viaDrawer: true });

  if (sessionId && !already) {
    await prisma.$transaction([
      prisma.payment.update({ where: { id: paymentId }, data: { registerSessionId: sessionId } }),
      prisma.cashMovement.create({
        data: {
          sessionId,
          type: "SALE",
          amount: payment.amount,
          referenceType: "ORDER",
          referenceId: payment.orderId,
          performedById: actor?.userId ?? null,
          reason: `Payment ${paymentId}`,
        },
      }),
    ]);
  }

  return { ...result, registerSessionId: sessionId };
}

/** Releases an authorisation, or abandons a pending charge. */
export async function voidPayment({ paymentId, reason = null }) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: SELECT });
  if (!payment) throw ApiError.notFound("Payment not found");

  if (payment.status === "CANCELLED") return { payment, changed: false };

  // Captured money is refunded, not voided. They are different events with
  // different accounting, and conflating them loses the audit trail of what was
  // actually taken.
  if (payment.status === "CAPTURED") {
    throw ApiError.conflict("This payment has been captured. Refund it instead of voiding it.");
  }
  if (!["PENDING", "AUTHORIZED"].includes(payment.status)) {
    throw ApiError.conflict(`A ${payment.status.toLowerCase()} payment cannot be voided`);
  }

  const adapter = getProvider(payment.provider);
  const { config, mode } = await resolveProviderConfig({
    branchId: payment.branchId,
    provider: payment.provider,
    requireEnabled: false,
  });
  const result = await adapter.void({ payment, config, mode });

  const updated = await withTransaction(async (tx) => {
    const row = await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: result.status ?? "CANCELLED",
        failureMessage: reason,
        rawResponse: result.raw ?? undefined,
      },
      select: SELECT,
    });
    await syncOrderPaymentState(tx, payment.orderId);
    return row;
  });

  return { payment: updated, changed: true };
}

/** Marks a payment failed — what a declined card or an abandoned checkout is. */
export async function failPayment({ paymentId, code = null, message = null, tx = null }) {
  const client = tx ?? prisma;

  const payment = await client.payment.update({
    where: { id: paymentId },
    data: {
      status: "FAILED",
      failedAt: new Date(),
      failureCode: code,
      failureMessage: message,
    },
    select: SELECT,
  });

  if (tx) await syncOrderPaymentState(tx, payment.orderId);
  else await withTransaction((inner) => syncOrderPaymentState(inner, payment.orderId));

  return payment;
}

// --- reads ------------------------------------------------------------------

export async function listPayments({ branchId, orderId, status, method, provider, scope = null, limit = 20, cursor } = {}) {
  // `scope` is the caller's branches; `branchId` is the one they asked for.
  // Both are applied. Omitting the filter must narrow to what they may see,
  // not widen to the company — a payment row carries what a customer paid and
  // how, at every outlet.
  const filter = branchFilter(scope);
  const rows = await prisma.payment.findMany({
    where: {
      ...(filter ? { AND: [{ branchId: filter }] } : {}),
      ...(branchId ? { branchId } : {}),
      ...(orderId ? { orderId } : {}),
      ...(status ? { status } : {}),
      ...(method ? { method } : {}),
      ...(provider ? { provider } : {}),
    },
    select: { ...SELECT, order: { select: { orderNumber: true, grandTotal: true } } },
    orderBy: { createdAt: "desc" },
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

export async function getPayment(id) {
  const payment = await prisma.payment.findUnique({
    where: { id },
    select: {
      ...SELECT,
      order: { select: { id: true, orderNumber: true, grandTotal: true, paymentState: true } },
      refunds: { select: { id: true, amount: true, status: true, reason: true, createdAt: true } },
    },
  });
  if (!payment) throw ApiError.notFound("Payment not found");
  return payment;
}

/** The payment picture for one order: what was taken, what is still owed. */
export async function orderPayments(orderId) {
  const order = await loadOrder(orderId);

  const payments = await prisma.payment.findMany({
    where: { orderId },
    select: SELECT,
    orderBy: { createdAt: "asc" },
  });

  const refunds = await prisma.refund.findMany({
    where: { orderId },
    select: { id: true, paymentId: true, amount: true, status: true, reason: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  return {
    orderId,
    orderNumber: order.orderNumber,
    currency: order.currency,
    grandTotal: order.grandTotal,
    paymentState: order.paymentState,
    amountDue: amountDue({ grandTotal: order.grandTotal, payments, refunds }),
    payments,
    refunds,
  };
}
