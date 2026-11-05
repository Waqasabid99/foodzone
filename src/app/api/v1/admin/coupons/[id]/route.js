import { apiHandler, ok, RateLimits } from "@/lib/api";
import { assertCouponAccess } from "@/server/marketing/access";
import { idParamSchema } from "@/server/validation/schemas";
import { updateCouponSchema } from "@/server/validation/pricing.schemas";
import { deleteCoupon, getCoupon, updateCoupon } from "@/server/services/coupon.service";

export const GET = apiHandler(
  { auth: true, permissions: "coupons.read", params: idParamSchema },
  async ({ params, auth }) => {
    await assertCouponAccess(auth, params.id, "coupons.read");
    return ok(await getCoupon(params.id));
  },
);

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "coupons.update",
    params: idParamSchema,
    body: updateCouponSchema,
    rateLimit: RateLimits.write,
    audit: { action: "coupon.update", entityType: "Coupon" },
  },
  async ({ params, body, auth }) => {
    await assertCouponAccess(auth, params.id, "coupons.update");
    return ok(await updateCoupon(params.id, body));
  },
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "coupons.delete",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "coupon.delete", entityType: "Coupon" },
  },
  async ({ params, auth }) => {
    await assertCouponAccess(auth, params.id, "coupons.delete");
    return ok(await deleteCoupon(params.id));
  },
);
