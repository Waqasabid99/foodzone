import { randomToken, verifySignature } from "@/server/utils/crypto";

/**
 * A fake online gateway.
 *
 * It exists so the *entire* online path — intent creation, a client redirect, a
 * signed webhook, idempotent processing, capture, partial refunds — is built,
 * exercised and tested before a real acquirer is chosen. When one is, it
 * implements this same interface and nothing else moves.
 *
 * It is deliberately realistic in the ways that break real integrations:
 *
 *   * signatures are **HMAC-SHA256 over the raw body**, verified in constant
 *     time, because that is what every real gateway does and it is where
 *     integrations get quietly broken by re-serialising the payload;
 *   * events carry a provider **event id**, so redelivery is a no-op;
 *   * amounts come back **from the event**, not from the local record, so the
 *     code has to handle a gateway that captured a different amount than asked.
 *
 * It never moves money and is refused outside development unless a secret is
 * explicitly configured — see `assertUsable`.
 */
export const mockProvider = {
  name: "mock",
  supportsOnline: true,
  methods: ["CARD", "UPI", "NET_BANKING", "WALLET"],

  /** The secret webhooks are signed with. */
  secret() {
    return process.env.MOCK_PAYMENT_SECRET ?? "mock-payment-secret";
  },

  /**
   * A mock gateway that is reachable in production is a way to mark orders paid
   * without paying, so it refuses to run there unless someone has deliberately
   * configured it.
   */
  assertUsable() {
    if (process.env.NODE_ENV === "production" && !process.env.MOCK_PAYMENT_SECRET) {
      const error = new Error("The mock payment provider is not available in production");
      error.status = 400;
      throw error;
    }
  },

  async createIntent({ payment, order, returnUrl = null }) {
    this.assertUsable();

    const providerOrderId = `mock_int_${randomToken(8)}`;

    return {
      providerOrderId,
      providerPaymentId: null,
      status: "PENDING",
      // What a client is told to do next. A real gateway returns a hosted
      // checkout URL or a client secret here; the shape is the same.
      clientAction: {
        type: "REDIRECT",
        url: `${process.env.APP_URL ?? ""}/pay/mock/${providerOrderId}`,
        returnUrl,
      },
      raw: { providerOrderId, amount: String(payment.amount), currency: order?.currency ?? "PKR" },
    };
  },

  async capture({ payment, amount }) {
    this.assertUsable();
    return {
      status: "CAPTURED",
      providerPaymentId: payment.providerPaymentId ?? `mock_pay_${randomToken(8)}`,
      capturedAmount: amount ?? payment.amount,
      feeAmount: 0,
      raw: { captured: true },
    };
  },

  async void() {
    this.assertUsable();
    return { status: "CANCELLED", raw: { voided: true } };
  },

  async refund({ refund }) {
    this.assertUsable();
    return {
      status: "COMPLETED",
      providerRefundId: `mock_ref_${randomToken(8)}`,
      raw: { refunded: String(refund.amount) },
    };
  },

  /**
   * Verified over the **raw request body**, never over a re-serialised object:
   * `JSON.parse` then `JSON.stringify` does not round-trip key order or number
   * formatting, so any signature checked against a re-encoded body is a
   * signature check that passes when it should fail.
   */
  verifySignature({ rawBody, headers }) {
    const signature = headers?.["x-mock-signature"] ?? headers?.get?.("x-mock-signature");
    if (!signature) return false;
    return verifySignature(rawBody, signature, this.secret());
  },

  /** Normalises a callback into the shape the webhook service understands. */
  parseEvent({ payload }) {
    if (!payload?.id || !payload?.type) return null;

    return {
      eventId: String(payload.id),
      type: String(payload.type),
      providerOrderId: payload.data?.providerOrderId ?? null,
      providerPaymentId: payload.data?.providerPaymentId ?? null,
      amount: payload.data?.amount ?? null,
      feeAmount: payload.data?.feeAmount ?? 0,
      failureCode: payload.data?.failureCode ?? null,
      failureMessage: payload.data?.failureMessage ?? null,
    };
  },
};
