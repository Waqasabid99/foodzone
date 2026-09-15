import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getPayslip } from "@/server/services/payroll.service";

export const GET = apiHandler(
  { auth: true, permissions: "payslips.view_all", params: idParamSchema },
  async ({ params }) => ok(await getPayslip(params.id)),
);
