import { apiHandler, ok, RateLimits } from "@/lib/api";
import { assertCompanyWide } from "@/lib/api/permissions";
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
  async ({ params, auth }) => {
    // A period belongs to the company, not to an outlet, so closing one closes
    // it everywhere. `can()` with no branch accepts any branch-pinned grant,
    // which would let a single outlet's finance role shut the books on every
    // other outlet; this asks the stricter question instead.
    assertCompanyWide(auth, "accounting_periods.close");
    return ok(await lockPeriod(params.id, auth));
  },
);
