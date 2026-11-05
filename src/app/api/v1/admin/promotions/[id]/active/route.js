import { apiHandler, ok, RateLimits } from "@/lib/api";
import { assertPromotionAccess, assertPromotionReach } from "@/server/marketing/access";
import { idParamSchema } from "@/server/validation/schemas";
import { setPromotionActiveSchema } from "@/server/validation/pricing.schemas";
import { setPromotionActive } from "@/server/services/promotion.service";

/**
 * Pausing a campaign is its own permission and its own endpoint.
 *
 * Stopping an offer that is losing money is an emergency action a duty manager
 * needs at 8pm on a Friday, and it should not require the ability to rewrite
 * the offer's rules.
 */
export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "promotions.activate",
    params: idParamSchema,
    body: setPromotionActiveSchema,
    rateLimit: RateLimits.write,
    audit: { action: "promotion.activate", entityType: "Promotion" },
  },
  async ({ params, body, auth }) => {
    const current = await assertPromotionAccess(auth, params.id, "promotions.activate");
    assertPromotionReach(auth, current.branchIds, "promotions.activate");
    return ok(await setPromotionActive(params.id, body.isActive));
  },
);
