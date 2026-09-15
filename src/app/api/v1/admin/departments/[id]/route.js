import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateDepartmentSchema } from "@/server/validation/hr.schemas";
import { updateDepartment } from "@/server/services/employee.service";

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "departments.manage",
    params: idParamSchema,
    body: updateDepartmentSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await updateDepartment(params.id, body, auth)),
);
