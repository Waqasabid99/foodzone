import { apiHandler, created, RateLimits } from "@/lib/api";
import { generateCouponsSchema } from "@/server/validation/pricing.schemas";
import { generateCoupons } from "@/server/services/coupon.service";

/**
 * Bulk-generates a campaign's codes.
 *
 * Behind its own permission rather than `coupons.create`: making one code for a
 * complaining customer and minting ten thousand printable ones are different
 * decisions, and only the second can flood the market with live discounts.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "coupons.generate_bulk",
    body: generateCouponsSchema,
    rateLimit: RateLimits.write,
    audit: { action: "coupon.generate_bulk", entityType: "Coupon" },
  },
  async ({ body, auth }) => created(await generateCoupons(body, auth)),
);
