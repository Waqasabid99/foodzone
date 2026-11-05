import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { setEmployeeStatusSchema } from "@/server/validation/hr.schemas";
import { setEmployeeStatus } from "@/server/services/employee.service";
import { assertRecordAccess } from "@/server/hr/access";

export const PUT = apiHandler(
  {
    auth: true,
    permissions: "employees.update",
    params: idParamSchema,
    body: setEmployeeStatusSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => {
    await assertRecordAccess(auth, "employee", params.id, "employees.update");
    return ok(await setEmployeeStatus(params.id, { ...body, actor: auth }));
  },
);
