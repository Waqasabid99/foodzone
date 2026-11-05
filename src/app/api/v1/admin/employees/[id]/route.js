import { apiHandler, noContent, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateEmployeeSchema } from "@/server/validation/hr.schemas";
import { deleteEmployee, getEmployee, updateEmployee } from "@/server/services/employee.service";
import { assertRecordAccess, salaryVisible, withoutPay } from "@/server/hr/access";

export const GET = apiHandler(
  { auth: true, permissions: "employees.read", params: idParamSchema },
  async ({ params, auth }) => {
    const branchId = await assertRecordAccess(auth, "employee", params.id, "employees.read");
    const employee = await getEmployee(params.id, { includeSalary: true });
    return ok(salaryVisible(auth, branchId) ? employee : withoutPay(employee));
  },
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
  async ({ params, body, auth }) => {
    await assertRecordAccess(auth, "employee", params.id, "employees.update");
    return ok(await updateEmployee(params.id, body, auth));
  },
);

/** Only somebody who never worked here. Everyone else is marked as having left. */
export const DELETE = apiHandler(
  { auth: true, permissions: "employees.delete", params: idParamSchema, rateLimit: RateLimits.write },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "employee", params.id, "employees.delete");
    await deleteEmployee(params.id, auth);
    return noContent();
  },
);
