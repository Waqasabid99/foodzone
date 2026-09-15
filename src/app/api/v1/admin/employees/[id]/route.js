import { apiHandler, can, noContent, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateEmployeeSchema } from "@/server/validation/hr.schemas";
import { deleteEmployee, getEmployee, updateEmployee } from "@/server/services/employee.service";

export const GET = apiHandler(
  { auth: true, permissions: "employees.read", params: idParamSchema },
  async ({ params, auth }) => ok(await getEmployee(params.id, { includeSalary: can(auth, "employees.view_salary") })),
);

/** Pay cannot be changed here — it moves through `/salary`, behind its own key. */
export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "employees.update",
    params: idParamSchema,
    body: updateEmployeeSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await updateEmployee(params.id, body, auth)),
);

/** Only somebody who never worked here. Everyone else is marked as having left. */
export const DELETE = apiHandler(
  { auth: true, permissions: "employees.delete", params: idParamSchema, rateLimit: RateLimits.write },
  async ({ params, auth }) => {
    await deleteEmployee(params.id, auth);
    return noContent();
  },
);
