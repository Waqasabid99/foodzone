import { ApiError } from "@/lib/api";

/**
 * Which gateway takes this payment.
 *
 * Pure on purpose: the branch's enabled gateways are read by the caller and
 * passed in, so the decision itself can be tested without a database and
 * without a running gateway.
 *
 * Methods that are settled by a person rather than an API — counter cash, cash
 * on delivery, a card swiped on a standalone terminal, an aggregator that pays
 * out weekly — always resolve to the cash provider. They have no API to call,
 * and routing them through a gateway would invent a settlement that never
 * happened.
 */
const MANUAL_METHODS = ["CASH", "CASH_ON_DELIVERY", "BANK_TRANSFER", "AGGREGATOR", "OTHER", "GIFT_CARD", "STORE_CREDIT"];

export function chooseProvider({ requested = null, method, enabled = [], allowMock = false }) {
  // An explicit choice is honoured: the customer picked it at checkout, or an
  // operator is recording a payment they know the origin of.
  if (requested) return requested;

  if (MANUAL_METHODS.includes(method)) return "cash";

  // The order the branch chose to offer them in, lowest first.
  const ordered = [...enabled].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  if (ordered.length) return ordered[0].provider;

  /*
   * Nothing configured.
   *
   * This used to fall through to the fake gateway unconditionally, which
   * reports success without moving any money. In development that is
   * convenient; anywhere else it is free food, and it would look like a
   * working integration right up until somebody read the bank statement.
   *
   * Whether faking a payment is permitted here is not decided again: it is
   * the mock provider's own rule — outside production, or in production only
   * when somebody deliberately set MOCK_PAYMENT_SECRET — resolved by the
   * caller and passed in. Two places answering "may we fake a payment" is how
   * they end up disagreeing.
   */
  if (allowMock) return "mock";

  throw ApiError.conflict("This branch has no online payment gateway switched on", {
    provider: ["Add a gateway's credentials under Payment gateways, then switch it on"],
  });
}
