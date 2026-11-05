import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getPayrollPeriod } from "@/server/services/payroll.service";
import { assertRecordAccess } from "@/server/hr/access";

export const GET = apiHandler(
  { auth: true, permissions: "payroll.read", params: idParamSchema },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "payrollPeriod", params.id, "payroll.read");
    return ok(await getPayrollPeriod(params.id));
  },
);
