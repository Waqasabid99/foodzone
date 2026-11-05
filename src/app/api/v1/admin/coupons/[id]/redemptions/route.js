import { apiHandler, ok } from "@/lib/api";
import { assertCouponAccess } from "@/server/marketing/access";
import { idParamSchema } from "@/server/validation/schemas";
import { paginationSchema } from "@/lib/api/pagination";
import { couponRedemptions } from "@/server/services/coupon.service";

export const GET = apiHandler(
  { auth: true, permissions: "coupons.read", params: idParamSchema, query: paginationSchema },
  async ({ params, query, auth }) => {
    // A redemption names the customer who used the code.
    await assertCouponAccess(auth, params.id, "coupons.read");
    return ok(await couponRedemptions(params.id, query));
  },
);
