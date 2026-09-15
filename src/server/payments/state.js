import { Prisma } from "@/generated/prisma";

/**
 * An order's payment state, derived — never stored by hand.
 *
 * This is the single most important function in the payments module. An order
 * has many Payment rows (a split bill, a retry after a decline, a tip added
 * later) and many Refund rows, and `Order.paymentState` is a *summary* of all
 * of them. The moment any code path sets that field directly from what it
 * happens to be doing, the summary and the rows disagree — and the rows are the
 * money, so the summary is what is wrong.
 *
 * So it is computed here, from the rows, and nowhere else.
 *
 * Kept pure and separate from the service so every awkward combination —
 * authorised but not captured, refunded more than one payment, a failed retry
 * next to a successful charge — is directly testable.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

/** Statuses whose money is actually in the merchant's hands. */
const SETTLED = ["CAPTURED", "REFUNDED", "PARTIALLY_REFUNDED"];

export function paymentTotals(payments = [], refunds = []) {
  let captured = D(0);
  let authorized = D(0);
  let refunded = D(0);
  let failed = 0;

  for (const payment of payments) {
    if (SETTLED.includes(payment.status)) captured = captured.plus(D(payment.amount));
    else if (payment.status === "AUTHORIZED") authorized = authorized.plus(D(payment.amount));
    else if (payment.status === "FAILED") failed += 1;
  }

  // Only refunds that actually completed reduce what was collected. A refund
  // that is merely requested or approved has moved no money, and treating it as
  // though it had would show an order as refunded while the customer is still
  // waiting for it.
  for (const refund of refunds) {
    if (refund.status === "COMPLETED") refunded = refunded.plus(D(refund.amount));
  }

  return { captured, authorized, refunded, netCaptured: captured.minus(refunded), failedCount: failed };
}

/**
 * The state to write onto the order.
 *
 * Order matters: refunds are checked before payment, because an order that was
 * paid and then refunded is *refunded*, not paid, even though the captured
 * total still covers the bill.
 */
export function derivePaymentState({ grandTotal, payments = [], refunds = [] }) {
  const total = D(grandTotal);
  const { captured, authorized, refunded, netCaptured, failedCount } = paymentTotals(payments, refunds);

  if (refunded.greaterThan(0)) {
    // Everything that was taken has been given back.
    return netCaptured.lessThanOrEqualTo(0) ? "REFUNDED" : "PARTIALLY_REFUNDED";
  }

  if (captured.greaterThanOrEqualTo(total) && total.greaterThan(0)) return "PAID";
  if (captured.greaterThan(0)) return "PARTIALLY_PAID";
  if (authorized.greaterThan(0)) return "AUTHORIZED";

  // FAILED only when every attempt failed. An order with one declined card and
  // one pending cash payment is still unpaid, not failed — the customer has a
  // way to pay and telling staff otherwise would have them chase a live order.
  if (failedCount > 0 && payments.every((payment) => payment.status === "FAILED")) return "FAILED";

  return "UNPAID";
}

/** What is still owed. Never negative: an overpayment is a refund, not a credit. */
export function amountDue({ grandTotal, payments = [], refunds = [] }) {
  const { netCaptured } = paymentTotals(payments, refunds);
  return Prisma.Decimal.max(D(grandTotal).minus(netCaptured), 0);
}
