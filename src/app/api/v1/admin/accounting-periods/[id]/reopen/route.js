import { apiHandler, ok, RateLimits } from "@/lib/api";
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
  async ({ params, body, auth }) => ok(await reopenPeriod(params.id, { reason: body.reason, actor: auth })),
);
