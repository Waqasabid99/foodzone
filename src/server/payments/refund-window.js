/**
 * How long a gateway will still accept a refund.
 *
 * Safepay: *"card refunds are only applicable for up to 90 days after the
 * transaction has completed."* Past that the gateway refuses. Without a check
 * of our own, a manager approves the refund, the customer is told their money
 * is coming, and the only evidence otherwise is a `FAILED` row that nobody is
 * watching — so the refusal happens here, early, with a date on it.
 *
 * ## Why there is no reversal path
 *
 * Safepay also suggests using a **reversal** rather than a refund within 24
 * hours of payment. That does not apply to us, and the reason is worth
 * recording so nobody adds it later on the strength of the documentation
 * alone:
 *
 *   * a reversal undoes an *authorisation that has not been captured*, and
 *   * our payments are always captured on the spot — Safepay's own support
 *     table lists "Separate Capture: No" for Express Checkout, which is the
 *     integration we use.
 *
 * There is therefore never an uncaptured authorisation to reverse. A reversal
 * also needs an `authorization` token we are never issued. If we ever move to
 * Safepay Atoms and start authorising separately, this is the comment that
 * says what changes.
 *
 * Pure: the caller supplies the clock, so the boundary is testable without
 * waiting ninety days.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function refundability({ capturedAt, now = new Date(), maxAgeDays = null }) {
  if (!capturedAt) {
    return {
      allowed: false,
      reason: "This payment has not been captured, so there is nothing to send back",
      lapsesAt: null,
      daysLeft: null,
    };
  }

  // No declared window means no rule. Cash has no gateway to say no, and a
  // provider that never declared a limit must not have one invented for it.
  if (maxAgeDays == null) {
    return { allowed: true, reason: null, lapsesAt: null, daysLeft: null };
  }

  const captured = capturedAt instanceof Date ? capturedAt : new Date(capturedAt);
  const lapsesAt = new Date(captured.getTime() + maxAgeDays * DAY_MS);
  const remainingMs = lapsesAt.getTime() - now.getTime();

  if (remainingMs < 0) {
    return {
      allowed: false,
      reason: `The gateway stops accepting refunds ${maxAgeDays} days after a payment, and that passed on ${lapsesAt.toISOString().slice(0, 10)}`,
      lapsesAt,
      daysLeft: 0,
    };
  }

  return {
    allowed: true,
    reason: null,
    lapsesAt,
    /*
     * Rounded **up**, because that is how people count days: with nine and a
     * half days to go you say "ten days left", not nine. Rounding down was
     * literally true and read as though a day had been stolen — a payment
     * taken eighty days ago reported nine.
     *
     * So the final, partial day is 1 and never 0: while a refund is still
     * possible the count never says zero, and zero is reserved for lapsed.
     */
    daysLeft: Math.max(1, Math.ceil(remainingMs / DAY_MS)),
  };
}
