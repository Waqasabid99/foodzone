import { apiHandler, ok, RateLimits } from "@/lib/api";
import { optionalAuth } from "@/lib/api/auth";
import { validateCouponSchema } from "@/server/validation/pricing.schemas";
import { validateCoupon } from "@/server/services/coupon.service";

/**
 * Checks a code before the customer commits to it.
 *
 * Answers only whether the code itself is usable by this caller — never what it
 * is worth, because that depends on a basket this endpoint deliberately does
 * not read. The cart is where a code's value is shown, so there is exactly one
 * place that computes it.
 *
 * Write-rated despite changing nothing: it is a yes/no oracle over a namespace
 * of short codes, so it has to cost something to ask.
 */
export const POST = apiHandler(
  { body: validateCouponSchema, rateLimit: RateLimits.write },
  async ({ request, body }) => {
    const principal = await optionalAuth(request);
    const result = await validateCoupon({ code: body.code, userId: principal?.userId ?? null });

    return ok(
      result.valid
        ? {
            valid: true,
            code: result.coupon.code,
            description: result.coupon.description ?? result.coupon.promotion.description,
            promotion: {
              name: result.coupon.promotion.name,
              type: result.coupon.promotion.type,
              minOrderAmount: result.coupon.promotion.minOrderAmount,
            },
          }
        : { valid: false, code: result.code, message: result.message },
    );
  },
);
