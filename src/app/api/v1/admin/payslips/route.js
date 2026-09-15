import { apiHandler, ok } from "@/lib/api";
import { listPayslipsSchema } from "@/server/validation/hr.schemas";
import { listPayslips } from "@/server/services/payroll.service";

/** Everybody's payslips — hence `payslips.view_all` rather than `payslips.read`. */
export const GET = apiHandler(
  { auth: true, permissions: "payslips.view_all", query: listPayslipsSchema },
  async ({ query }) => ok(await listPayslips(query)),
);
