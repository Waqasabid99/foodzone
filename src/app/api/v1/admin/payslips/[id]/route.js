import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getPayslip } from "@/server/services/payroll.service";
import { assertRecordAccess } from "@/server/hr/access";

export const GET = apiHandler(
  { auth: true, permissions: "payslips.view_all", params: idParamSchema },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "payslip", params.id, "payslips.view_all");
    return ok(await getPayslip(params.id));
  },
);
