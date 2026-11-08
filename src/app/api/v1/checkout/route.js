import { ApiError, apiHandler, created, RateLimits } from "@/lib/api";
import { optionalAuth, requireVerifiedEmail } from "@/lib/api/auth";
import { checkoutSchema } from "@/server/validation/ordering.schemas";
import { resolveCart, claimGuestCart } from "@/server/services/cart.service";
import { checkoutCart } from "@/server/services/checkout.service";
import { getOrder } from "@/server/services/order.service";
import { startOnlinePayment } from "@/server/services/checkout-payment.service";

/**
 * Turns the caller's cart into an order.
 *
 * A signed-in customer must have verified their email first — the gate that
 * makes it safe for an unverified account to hold a session at all. A guest
 * cart is claimed onto the account here if one is still attached, so a customer
 * who filled a basket and then signed in at checkout keeps it.
 *
 * Prices are re-resolved from the live menu inside this call. Whatever the
 * client last displayed is irrelevant; the order is priced at the moment of
 * purchase.
 */
export const POST = apiHandler(
  { body: checkoutSchema, rateLimit: RateLimits.checkout, scope: "checkout" },
  async ({ request, body, sessionId, client }) => {
    const principal = await optionalAuth(request);
    if (principal) requireVerifiedEmail(principal);

    if (principal && sessionId) await claimGuestCart({ userId: principal.userId, sessionId });

    const cart = await resolveCart({ userId: principal?.userId ?? null, sessionId, create: false });
    if (!cart?.items?.length) {
      throw ApiError.validation("Your cart is empty", { items: ["Add at least one item"] });
    }

    const orderId = await checkoutCart({
      cart,
      userId: principal?.userId ?? null,
      guest: body.guest ?? null,
      input: body,
      channel: client === "IOS" || client === "ANDROID" ? "MOBILE_APP" : "WEB",
    });

    const order = await getOrder(orderId);

    /*
     * A customer who chose to pay now gets the gateway's hosted page.
     *
     * Started here, in the same request that created the order, so there is no
     * second endpoint that takes an order id and starts a charge against it —
     * which would have to re-establish who is allowed to pay for whose order,
     * for guests with no account. The order exists either way; a gateway that
     * refuses leaves it placed and unpaid rather than losing it.
     */
    /*
     * Store credit may have settled the bill outright, in which case there is
     * nothing for a gateway to charge: `createPayment` would refuse an order
     * that owes nothing, and that refusal would surface as a failed checkout
     * on an order that is placed and fully paid. A remainder still goes to the
     * gateway as usual.
     */
    const payment = body.payWith && order.paymentState !== "PAID"
      ? await startOnlinePayment({ order, payWith: body.payWith })
      : null;

    return created(
      { ...order, ...(payment ? { payment: payment.summary, clientAction: payment.clientAction } : {}) },
      { location: `/api/v1/me/orders/${orderId}` },
    );
  },
);
