import { apiHandler, created, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { salaryComponentSchema } from "@/server/validation/hr.schemas";
import { addSalaryComponent } from "@/server/services/employee.service";

/**
 * A recurring earning or deduction.
 *
 * Exactly one of a flat amount or a percentage of base — a component that is
 * both is ambiguous, and whichever the code reads first decides somebody's pay.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "employees.manage_salary",
    params: idParamSchema,
    body: salaryComponentSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => created(await addSalaryComponent(params.id, body, auth)),
);
