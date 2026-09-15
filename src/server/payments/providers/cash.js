/**
 * Cash, and everything else settled off-system.
 *
 * Counter cash, cash on delivery, a card swiped on a standalone terminal, an
 * aggregator that settles weekly by bank transfer. None of them have an API to
 * call: the "integration" is a person confirming that money changed hands.
 *
 * It is still a provider rather than a special case scattered through the
 * services, because the moment cash is special-cased, the reporting, the refund
 * flow and the order's payment state all grow a second code path — and cash is
 * the majority of a restaurant's takings, so that second path would be the one
 * that mattered most.
 */
export const cashProvider = {
  name: "cash",
  supportsOnline: false,
  methods: ["CASH", "CASH_ON_DELIVERY", "CARD", "BANK_TRANSFER", "AGGREGATOR", "OTHER"],

  /**
   * There is nothing to create. The payment row is the record; it stays PENDING
   * until someone with `payments.mark_collected` says the money arrived.
   */
  async createIntent({ payment }) {
    return {
      providerOrderId: null,
      providerPaymentId: null,
      status: "PENDING",
      // No client action: the customer pays a human.
      clientAction: null,
      raw: { note: "Settled outside the system", amount: String(payment.amount) },
    };
  },

  /** Capturing cash is the act of collecting it, which the service records. */
  async capture({ payment, amount }) {
    return { status: "CAPTURED", capturedAmount: amount ?? payment.amount, raw: { method: "manual" } };
  },

  async void() {
    return { status: "CANCELLED", raw: { method: "manual" } };
  },

  /**
   * A cash refund is money out of the drawer. It completes immediately because
   * it already happened in the real world — the service is recording it, not
   * requesting it.
   */
  async refund({ refund }) {
    return { status: "COMPLETED", providerRefundId: null, raw: { method: "manual", amount: String(refund.amount) } };
  },

  /** Nothing calls back, so nothing can be forged. */
  verifySignature() {
    return false;
  },

  parseEvent() {
    return null;
  },
};
