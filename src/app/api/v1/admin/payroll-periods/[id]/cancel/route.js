import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { cancelPayrollSchema } from "@/server/validation/hr.schemas";
import { cancelPayroll } from "@/server/services/payroll.service";
import { assertRecordAccess } from "@/server/hr/access";

/** Unlocks the attendance it froze. Refused once paid — the money has gone. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "payroll.approve",
    params: idParamSchema,
    body: cancelPayrollSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => {
    await assertRecordAccess(auth, "payrollPeriod", params.id, "payroll.approve");
    return ok(await cancelPayroll(params.id, { reason: body.reason, actor: auth }));
  },
);
