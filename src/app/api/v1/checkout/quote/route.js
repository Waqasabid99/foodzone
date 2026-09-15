import { apiHandler, ok, RateLimits } from "@/lib/api";
import { optionalAuth } from "@/lib/api/auth";
import { quoteSchema } from "@/server/validation/ordering.schemas";
import { orderChannelFor } from "@/server/services/cart.service";
import { quoteOrder } from "@/server/services/checkout.service";

/**
 * Prices a prospective order without placing it.
 *
 * What a checkout screen calls when the customer changes the tip or switches
 * between delivery and pickup, so the total shown is the total that will be
 * charged. The caller is resolved because discounts depend on who is asking —
 * a first-order offer and a per-customer redemption cap both need an identity.
 */
export const POST = apiHandler(
  { body: quoteSchema, rateLimit: RateLimits.read, scope: "checkout:quote" },
  async ({ request, body, client }) => {
    const principal = await optionalAuth(request);

    return ok(
      await quoteOrder({
        ...body,
        userId: principal?.userId ?? null,
        channel: orderChannelFor(client),
      }),
    );
  },
);
