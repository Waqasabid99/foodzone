import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { lockPeriod } from "@/server/services/fiscal.service";

/**
 * Locks a period for good. One-way, deliberately.
 *
 * By this point the numbers have been filed and have left the building, so a
 * quiet change afterwards would make the filed copy a lie.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "accounting_periods.close",
    params: idParamSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, auth }) => ok(await lockPeriod(params.id, auth)),
);
