import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getPayrollPeriod } from "@/server/services/payroll.service";

export const GET = apiHandler(
  { auth: true, permissions: "payroll.read", params: idParamSchema },
  async ({ params }) => ok(await getPayrollPeriod(params.id)),
);
