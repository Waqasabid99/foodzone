import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { createCouponSchema, listCouponsSchema } from "@/server/validation/pricing.schemas";
import { createCoupon, listCoupons } from "@/server/services/coupon.service";

export const GET = apiHandler(
  { auth: true, permissions: "coupons.read", query: listCouponsSchema },
  async ({ query }) => ok(await listCoupons(query)),
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "coupons.create",
    body: createCouponSchema,
    rateLimit: RateLimits.write,
    audit: { action: "coupon.create", entityType: "Coupon", entityId: ({ result }) => result?.id ?? null },
  },
  async ({ body, auth }) => created(await createCoupon(body, auth)),
);
