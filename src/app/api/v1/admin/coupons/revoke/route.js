import { apiHandler, ok, RateLimits } from "@/lib/api";
import { branchScope } from "@/lib/api/permissions";
import { revokeCampaignSchema } from "@/server/validation/pricing.schemas";
import { revokeCampaign } from "@/server/services/coupon.service";

/** Kills a whole printed run at once — what you reach for when codes leak. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "coupons.update",
    body: revokeCampaignSchema,
    rateLimit: RateLimits.write,
    audit: { action: "coupon.revoke_campaign", entityType: "Coupon" },
  },
  async ({ body, auth }) =>
    ok(await revokeCampaign(body.campaign, { scope: branchScope(auth, "coupons.update") })),
);
