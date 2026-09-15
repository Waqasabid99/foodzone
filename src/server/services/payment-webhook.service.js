import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { logger } from "@/lib/logger";
import { getProvider } from "@/server/payments/providers";
import { syncOrderPaymentState } from "@/server/services/payment.service";
import { money } from "@/server/pricing/engine";

/**
 * Gateway webhooks.
 *
 * A webhook is an untrusted HTTP request that claims money moved, so it is
 * handled in a fixed order and nothing is skipped:
 *
 *   1. **Verify the signature over the raw body.** Before parsing, before
 *      looking anything up. An unsigned callback is an open endpoint for
 *      marking any order paid.
 *   2. **Store the event.** Keyed on `(provider, eventId)`, so redelivery — which
 *      every gateway does, often, and sometimes out of order — is a no-op.
 *   3. **Process it**, and record the outcome on the row.
 *
 * The endpoint returns 200 for anything it has durably stored, including events
 * it does not understand. A gateway that receives a non-2xx retries with
 * backoff and eventually disables the endpoint; failing the request because
 * *our* handler has a bug turns one bug into a dead integration. The failure is
 * recorded on the row and replayed deliberately instead.
 */

const SELECT = {
  id: true,
  provider: true,
  eventId: true,
  eventType: true,
  status: true,
  attempts: true,
  error: true,
  processedAt: true,
  createdAt: true,
};

/**
 * Takes a raw callback: verifies, stores, processes.
 *
 * `rawBody` must be the **exact bytes received**. Re-serialising a parsed object
 * does not round-trip key order or number formatting, so a signature checked
 * against re-encoded JSON is a check that passes when it should fail.
 */
export async function handleWebhook({ providerName, rawBody, headers }) {
  const provider = getProvider(providerName);

  if (!provider.verifySignature({ rawBody, headers })) {
    // 401 and nothing stored. Persisting unverified callbacks would let anyone
    // fill the table, and a replay of one would then apply it.
    throw ApiError.unauthorized("Invalid webhook signature");
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw ApiError.validation("Webhook body is not valid JSON");
  }

  const event = provider.parseEvent({ payload });
  if (!event?.eventId) {
    throw ApiError.validation("Webhook is missing an event id", { id: ["Required for idempotency"] });
  }

  // Stored first, processed second. If processing throws, the event is on disk
  // and replayable rather than lost with the request.
  const existing = await prisma.paymentWebhookEvent.findUnique({
    where: { provider_eventId: { provider: provider.name, eventId: event.eventId } },
    select: SELECT,
  });

  if (existing) {
    // Redelivery of something already handled is success, not a conflict — a
    // gateway retrying a call it never saw the response to must be told 200.
    if (existing.status === "PROCESSED" || existing.status === "IGNORED") {
      return { received: true, duplicate: true, status: existing.status, eventId: event.eventId };
    }
    return processStored(existing.id, event, provider.name);
  }

  const stored = await prisma.paymentWebhookEvent.create({
    data: {
      provider: provider.name,
      eventId: event.eventId,
      eventType: event.type ?? "unknown",
      payload,
      signature: headers?.["x-mock-signature"] ?? headers?.get?.("x-mock-signature") ?? null,
      status: "RECEIVED",
    },
    select: SELECT,
  });

  return processStored(stored.id, event, provider.name);
}

/** Applies a stored event, recording the outcome either way. */
async function processStored(webhookEventId, event, providerName) {
  try {
    const outcome = await applyEvent(event, providerName);

    await prisma.paymentWebhookEvent.update({
      where: { id: webhookEventId },
      data: {
        status: outcome.handled ? "PROCESSED" : "IGNORED",
        processedAt: new Date(),
        attempts: { increment: 1 },
        error: null,
      },
    });

    // The event's processing status and the payment's status are two different
    // things, and they were briefly one field — spreading the outcome let
    // "CAPTURED" overwrite "PROCESSED". They are kept apart deliberately.
    return {
      received: true,
      duplicate: false,
      status: outcome.handled ? "PROCESSED" : "IGNORED",
      handled: outcome.handled,
      reason: outcome.reason ?? null,
      payment: outcome.paymentId
        ? { id: outcome.paymentId, status: outcome.status ?? null, amountMismatch: outcome.amountMismatch ?? null }
        : null,
    };
  } catch (error) {
    logger.error("payment webhook failed", { webhookEventId, provider: providerName, error: error.message });

    await prisma.paymentWebhookEvent.update({
      where: { id: webhookEventId },
      data: { status: "FAILED", attempts: { increment: 1 }, error: error.message?.slice(0, 1000) ?? "unknown" },
    });

    // Deliberately not rethrown: the event is stored and replayable, and a 500
    // here would have the gateway retry then disable the endpoint.
    return { received: true, duplicate: false, status: "FAILED", error: error.message };
  }
}

/**
 * Turns a normalised event into a payment change.
 *
 * Unknown event types are *ignored*, not errors: gateways add event types
 * without asking, and a webhook endpoint that fails on anything unfamiliar
 * breaks the moment the provider ships a feature.
 */
async function applyEvent(event, providerName) {
  const payment = await findPayment(event, providerName);
  if (!payment) return { handled: false, reason: "NO_MATCHING_PAYMENT" };

  const type = String(event.type ?? "").toLowerCase();

  if (type.includes("succeeded") || type.includes("captured") || type.includes("paid")) {
    return applyCapture(payment, event);
  }

  if (type.includes("failed") || type.includes("declined")) {
    if (payment.status === "CAPTURED") {
      // A late failure for money already captured is a provider ordering
      // problem, not an instruction to un-capture. Recorded, not applied.
      return { handled: false, reason: "ALREADY_CAPTURED" };
    }
    await withTransaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "FAILED",
          failedAt: new Date(),
          failureCode: event.failureCode ?? null,
          failureMessage: event.failureMessage ?? null,
          rawResponse: event.raw ?? undefined,
        },
      });
      await syncOrderPaymentState(tx, payment.orderId);
    });
    return { handled: true, paymentId: payment.id, status: "FAILED" };
  }

  if (type.includes("authorized") || type.includes("authorised")) {
    if (["CAPTURED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(payment.status)) {
      return { handled: false, reason: "ALREADY_CAPTURED" };
    }
    await withTransaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "AUTHORIZED",
          authorizedAt: new Date(),
          providerPaymentId: event.providerPaymentId ?? payment.providerPaymentId,
        },
      });
      await syncOrderPaymentState(tx, payment.orderId);
    });
    return { handled: true, paymentId: payment.id, status: "AUTHORIZED" };
  }

  if (type.includes("cancel") || type.includes("expired")) {
    if (payment.status === "CAPTURED") return { handled: false, reason: "ALREADY_CAPTURED" };
    await withTransaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: type.includes("expired") ? "EXPIRED" : "CANCELLED" },
      });
      await syncOrderPaymentState(tx, payment.orderId);
    });
    return { handled: true, paymentId: payment.id, status: "CANCELLED" };
  }

  return { handled: false, reason: "UNHANDLED_EVENT_TYPE", eventType: event.type };
}

/** Applying a capture is idempotent — the same event twice must not double-count. */
async function applyCapture(payment, event) {
  if (["CAPTURED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(payment.status)) {
    return { handled: false, reason: "ALREADY_CAPTURED", paymentId: payment.id };
  }

  // The gateway's amount wins over the local one: it is what actually moved,
  // and a mismatch is exactly the case a reconciliation has to surface rather
  // than paper over.
  const captured = event.amount != null ? money(event.amount) : payment.amount;

  await withTransaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "CAPTURED",
        amount: captured,
        feeAmount: event.feeAmount != null ? money(event.feeAmount) : payment.feeAmount,
        providerPaymentId: event.providerPaymentId ?? payment.providerPaymentId,
        capturedAt: new Date(),
      },
    });
    await syncOrderPaymentState(tx, payment.orderId);
  });

  return {
    handled: true,
    paymentId: payment.id,
    status: "CAPTURED",
    amountMismatch: String(captured) !== String(payment.amount) ? { expected: payment.amount, actual: captured } : null,
  };
}

/** Matches an event to a local payment by either provider id. */
async function findPayment(event, providerName) {
  if (event.providerPaymentId) {
    const byPaymentId = await prisma.payment.findUnique({
      where: { providerPaymentId: event.providerPaymentId },
      select: { id: true, orderId: true, status: true, amount: true, feeAmount: true, providerPaymentId: true },
    });
    if (byPaymentId) return byPaymentId;
  }

  if (event.providerOrderId) {
    return prisma.payment.findFirst({
      where: { provider: providerName, providerOrderId: event.providerOrderId },
      select: { id: true, orderId: true, status: true, amount: true, feeAmount: true, providerPaymentId: true },
      orderBy: { createdAt: "desc" },
    });
  }

  return null;
}

// --- administration ---------------------------------------------------------

export async function listWebhookEvents({ provider, status, limit = 20, cursor } = {}) {
  const rows = await prisma.paymentWebhookEvent.findMany({
    where: { ...(provider ? { provider } : {}), ...(status ? { status } : {}) },
    select: SELECT,
    orderBy: { createdAt: "desc" },
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

export async function getWebhookEvent(id) {
  const event = await prisma.paymentWebhookEvent.findUnique({
    where: { id },
    select: { ...SELECT, payload: true, signature: true },
  });
  if (!event) throw ApiError.notFound("Webhook event not found");
  return event;
}

/**
 * Replays a stored event.
 *
 * The signature is **not** re-checked: it was verified when the event arrived,
 * and the stored payload is trusted precisely because nothing unverified is
 * ever stored. Replay is permission-gated instead.
 */
export async function replayWebhookEvent(id) {
  const stored = await prisma.paymentWebhookEvent.findUnique({
    where: { id },
    select: { id: true, provider: true, payload: true },
  });
  if (!stored) throw ApiError.notFound("Webhook event not found");

  const provider = getProvider(stored.provider);
  const event = provider.parseEvent({ payload: stored.payload });
  if (!event?.eventId) throw ApiError.conflict("That event cannot be parsed by its provider any more");

  return processStored(stored.id, event, stored.provider);
}
