import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { markPaidSchema } from "@/server/validation/hr.schemas";
import { markPayrollPaid } from "@/server/services/payroll.service";

/** Records that the money actually left, and clears the payable. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "payroll.mark_paid",
    params: idParamSchema,
    body: markPaidSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await markPayrollPaid(params.id, { ...body, actor: auth })),
);
