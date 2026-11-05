import { apiHandler, ok, RateLimits } from "@/lib/api";
import { assertRecordAccess } from "@/server/finance/access";
import { idParamSchema } from "@/server/validation/schemas";
import { approveRefund } from "@/server/services/refund.service";

/**
 * Approves a refund and sends it to the provider.
 *
 * Audited inline by the service — money leaving the business is the one record
 * that must not depend on a fire-and-forget write completing.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "refunds.approve",
    params: idParamSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, auth, ipAddress, userAgent }) => {
    await assertRecordAccess(auth, "refund", params.id, "refunds.approve");
    return ok(await approveRefund({ refundId: params.id, actor: auth, context: { ipAddress, userAgent } }));
  },
);
