import { apiHandler, ok, RateLimits } from "@/lib/api";
import { assertCompanyWide } from "@/lib/api/permissions";
import { idParamSchema } from "@/server/validation/schemas";
import { reopenPeriodSchema } from "@/server/validation/finance.schemas";
import { reopenPeriod } from "@/server/services/fiscal.service";

/**
 * Reopens a closed period.
 *
 * A reason is required and the reopening is audited, because this is exactly
 * the event an auditor comes looking for: figures that were reported as final
 * and then moved.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "accounting_periods.reopen",
    params: idParamSchema,
    body: reopenPeriodSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => {
    // Reopening a closed period lets the figures move again for every outlet,
    // so it takes a company-wide grant for the same reason closing does.
    assertCompanyWide(auth, "accounting_periods.reopen");
    return ok(await reopenPeriod(params.id, { reason: body.reason, actor: auth }));
  },
);
