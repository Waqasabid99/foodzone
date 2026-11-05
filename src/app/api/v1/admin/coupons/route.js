import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { branchScope } from "@/lib/api/permissions";
import { assertPromotionAccess } from "@/server/marketing/access";
import { createCouponSchema, listCouponsSchema } from "@/server/validation/pricing.schemas";
import { createCoupon, listCoupons } from "@/server/services/coupon.service";

export const GET = apiHandler(
  { auth: true, permissions: "coupons.read", query: listCouponsSchema },
  async ({ query, auth }) => ok(await listCoupons({ ...query, scope: branchScope(auth, "coupons.read") })),
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "coupons.create",
    body: createCouponSchema,
    rateLimit: RateLimits.write,
    audit: { action: "coupon.create", entityType: "Coupon", entityId: ({ result }) => result?.id ?? null },
  },
  async ({ body, auth }) => {
    // A coupon inherits its reach from the promotion it unlocks, so the
    // question is whether the caller may hand out that offer.
    await assertPromotionAccess(auth, body.promotionId, "coupons.create");
    return created(await createCoupon(body, auth));
  },
);
