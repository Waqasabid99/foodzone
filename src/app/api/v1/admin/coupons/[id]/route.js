import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateCouponSchema } from "@/server/validation/pricing.schemas";
import { deleteCoupon, getCoupon, updateCoupon } from "@/server/services/coupon.service";

export const GET = apiHandler(
  { auth: true, permissions: "coupons.read", params: idParamSchema },
  async ({ params }) => ok(await getCoupon(params.id)),
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
  async ({ params, body }) => ok(await updateCoupon(params.id, body)),
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "coupons.delete",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "coupon.delete", entityType: "Coupon" },
  },
  async ({ params }) => ok(await deleteCoupon(params.id)),
);
