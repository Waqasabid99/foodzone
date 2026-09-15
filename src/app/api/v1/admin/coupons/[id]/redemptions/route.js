import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { paginationSchema } from "@/lib/api/pagination";
import { couponRedemptions } from "@/server/services/coupon.service";

export const GET = apiHandler(
  { auth: true, permissions: "coupons.read", params: idParamSchema, query: paginationSchema },
  async ({ params, query }) => ok(await couponRedemptions(params.id, query)),
);
