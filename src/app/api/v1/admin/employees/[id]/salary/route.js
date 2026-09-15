import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateSalarySchema } from "@/server/validation/hr.schemas";
import { updateSalary } from "@/server/services/employee.service";

/** Always audited with the before and after — a pay change is what audit is for. */
export const PUT = apiHandler(
  {
    auth: true,
    permissions: "employees.manage_salary",
    params: idParamSchema,
    body: updateSalarySchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await updateSalary(params.id, body, auth)),
);
