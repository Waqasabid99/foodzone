import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { postCount } from "@/server/services/stock-count.service";
import { assertRecordAccess } from "@/server/inventory/access";

/**
 * Posts the count, writing a correction for every non-zero variance.
 *
 * Approval is separate from counting for the same reason a cash variance is
 * signed off by a manager: the person who is short should not be the person who
 * accepts being short.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "stock_counts.approve",
    params: idParamSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "count", params.id, "stock_counts.approve");
    return ok(await postCount(params.id, auth));
  },
);
