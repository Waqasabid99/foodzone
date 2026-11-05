import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { generatePayrollSchema } from "@/server/validation/hr.schemas";
import { generatePayroll } from "@/server/services/payroll.service";
import { assertRecordAccess } from "@/server/hr/access";

/**
 * Builds payslips from approved attendance.
 *
 * Re-runnable while the period is a draft, so a corrected attendance day flows
 * straight through. Payslips already approved or paid are left alone.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "payroll.process",
    params: idParamSchema,
    body: generatePayrollSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => {
    await assertRecordAccess(auth, "payrollPeriod", params.id, "payroll.process");
    return ok(await generatePayroll(params.id, { employeeIds: body.employeeIds, actor: auth }));
  },
);
