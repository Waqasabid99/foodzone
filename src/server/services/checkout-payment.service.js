import { ApiError } from "@/lib/api";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import { createPayment } from "@/server/services/payment.service";
import { publicPaymentOptions } from "@/server/services/payment-provider.service";

/**
 * Starts the hosted-gateway leg of a customer checkout.
 *
 * Separate from `payment.service` because the rules here are about a *public*
 * caller, not an operator: the gateway has to be one this branch actually
 * switched on, the method is inferred rather than supplied, and a failure must
 * leave the order standing.
 */

/**
 * The method recorded against the payment.
 *
 * Hosted checkout lets the customer pick the rail on the gateway's own page —
 * card, wallet, Raast — and tells us which they used in the callback. So
 * guessing here would be inventing a fact we are about to be told, and the
 * webhook corrects it. `CARD` is the honest placeholder only because it is
 * what the gateway's first screen offers.
 */
function methodFor(provider, options) {
  const match = options.find((option) => option.provider === provider);
  return match?.methods?.[0] ?? "CARD";
}

export async function startOnlinePayment({ order, payWith }) {
  /*
   * Checked against what the branch switched on, not against the registry.
   *
   * Taking the name on trust would let a customer name any registered gateway
   * — including the fake one, which reports success without moving money — and
   * have their order marked paid.
   */
  const options = await publicPaymentOptions({ branchId: order.branchId });
  if (!options.some((option) => option.provider === payWith)) {
    throw ApiError.validation("That payment method is not available here", {
      payWith: [options.length ? `Available: ${options.map((o) => o.provider).join(", ")}` : "This branch takes payment in person only"],
    });
  }

  // Where the gateway sends the customer back. The order is named rather than
  // the gateway's own reference, because the page has to work even when the
  // gateway returns nothing useful — and it must never treat the redirect
  // itself as proof of payment.
  const base = (env().APP_URL ?? "").replace(/\/+$/, "");
  const returnUrl = `${base}/checkout/complete?order=${encodeURIComponent(order.id)}`;
  const cancelUrl = `${base}/checkout/complete?order=${encodeURIComponent(order.id)}&cancelled=1`;

  try {
    const result = await createPayment({
      orderId: order.id,
      method: methodFor(payWith, options),
      provider: payWith,
      returnUrl,
      cancelUrl,
    });

    if (!result?.clientAction?.url) {
      throw new Error("The gateway did not return anywhere to send the customer");
    }

    return {
      clientAction: result.clientAction,
      summary: { id: result.payment.id, status: result.payment.status, provider: payWith },
    };
  } catch (error) {
    /*
     * The order is already placed and the cart already emptied, inside a
     * transaction that has committed. Rethrowing would show the customer a
     * failure for an order that genuinely exists, and they would place it
     * again.
     *
     * So a gateway that will not start is reported as "pay in person" rather
     * than as a lost order. The kitchen still gets it; the money is collected
     * the way it was before any gateway existed.
     */
    logger.error("could not start an online payment", {
      orderId: order.id,
      provider: payWith,
      error: error.message,
    });
    return { clientAction: null, summary: { id: null, status: "UNAVAILABLE", provider: payWith } };
  }
}
