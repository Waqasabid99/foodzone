import { z } from "zod";
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
  /** What a person should see. The registry key is an identifier, not a name. */
  label: "Test gateway",
  /** One line of customer-facing copy, shown under the option at checkout. */
  description: "A fake gateway for development. It never moves money.",
  signatureHeader: "x-mock-signature",
  supportsOnline: true,
  methods: ["CARD", "UPI", "NET_BANKING", "WALLET"],

  /**
   * Declared so the bring-your-own-credentials path has something to exercise
   * end to end before a real gateway is configured — the same shape Safepay's
   * webhook secret will have.
   */
  credentials: [
    {
      key: "webhookSecret",
      label: "Webhook signing secret",
      type: "string",
      secret: true,
      // Optional by design: `secret()` falls back to MOCK_PAYMENT_SECRET, so
      // the fake gateway works before any branch has been configured. A real
      // gateway has no such fallback and marks its fields required.
      required: false,
      schema: z.string().trim().min(8),
      hint: "Used to verify that a callback really came from the gateway.",
    },
  ],

  /**
   * The secret webhooks are signed with.
   *
   * Per-branch config wins when there is any, so each outlet can hold its own
   * credentials. The environment variable stays as a fallback for the e2e
   * suite and for a developer with nothing configured — it is the deployment's
   * secret, not a restaurant's, which is exactly the distinction the real
   * gateways force us to make.
   */
  secret(config = null) {
    return config?.webhookSecret ?? process.env.MOCK_PAYMENT_SECRET ?? "mock-payment-secret";
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
  verifySignature({ rawBody, headers, config = null }) {
    const signature = headers?.["x-mock-signature"] ?? headers?.get?.("x-mock-signature");
    if (!signature) return false;
    // The branch's own secret when it has one, the deployment's otherwise.
    return verifySignature(rawBody, signature, this.secret(config));
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
