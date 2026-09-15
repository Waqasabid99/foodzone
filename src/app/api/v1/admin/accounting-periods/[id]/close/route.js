import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { closePeriod } from "@/server/services/fiscal.service";

/**
 * Closes a period. Nothing posts into it afterwards.
 *
 * Refused while a draft entry still sits in it, and refused while an earlier
 * period is still open — a closed month with an open one behind it is a set of
 * figures that can still change underneath a report already published.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "accounting_periods.close",
    params: idParamSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, auth }) => ok(await closePeriod(params.id, auth)),
);
