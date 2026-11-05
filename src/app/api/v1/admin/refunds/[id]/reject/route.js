import { apiHandler, ok, RateLimits } from "@/lib/api";
import { assertRecordAccess } from "@/server/finance/access";
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
  async ({ params, body, auth }) => {
    await assertRecordAccess(auth, "refund", params.id, "refunds.reject");
    return ok(await rejectRefund({ refundId: params.id, reason: body?.reason ?? null, actor: auth }));
  },
);
