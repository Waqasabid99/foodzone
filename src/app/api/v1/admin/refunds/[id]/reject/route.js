import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { rejectRefundSchema } from "@/server/validation/payment.schemas";
import { rejectRefund } from "@/server/services/refund.service";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "refunds.reject",
    params: idParamSchema,
    body: rejectRefundSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) =>
    ok(await rejectRefund({ refundId: params.id, reason: body?.reason ?? null, actor: auth })),
);
