import { z } from "zod";
import { apiHandler, ok, RateLimits } from "@/lib/api";
import { cuidSchema } from "@/server/validation/schemas";
import { endComponentSchema } from "@/server/validation/hr.schemas";
import { endSalaryComponent } from "@/server/services/employee.service";
import { assertRecordAccess } from "@/server/hr/access";

const paramsSchema = z.object({ id: cuidSchema, componentId: cuidSchema });

/**
 * Ends a component rather than deleting it.
 *
 * A payslip already generated referenced it, and removing the row would leave
 * that payslip unable to explain one of its own lines.
 */
export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "employees.manage_salary",
    params: paramsSchema,
    body: endComponentSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => {
    await assertRecordAccess(auth, "employee", params.id, "employees.manage_salary");
    return ok(await endSalaryComponent(params.id, params.componentId, { effectiveTo: body.effectiveTo, actor: auth }));
  },
);
