import { apiHandler, ok, RateLimits } from "@/lib/api";
import { assertCompanyWide } from "@/lib/api/permissions";
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
  async ({ params, auth }) => {
    // A period belongs to the company, not to an outlet, so closing one closes
    // it everywhere. `can()` with no branch accepts any branch-pinned grant,
    // which would let a single outlet's finance role shut the books on every
    // other outlet; this asks the stricter question instead.
    assertCompanyWide(auth, "accounting_periods.close");
    return ok(await closePeriod(params.id, auth));
  },
);
