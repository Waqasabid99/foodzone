import { apiHandler, can, created, ok, RateLimits } from "@/lib/api";
import { createEmployeeSchema, listEmployeesSchema } from "@/server/validation/hr.schemas";
import { createEmployee, listEmployees } from "@/server/services/employee.service";

/**
 * Pay is withheld without `employees.view_salary`.
 *
 * A shift supervisor needs to see who works here; they must not see what
 * everybody earns, and one permission for both means whoever builds the roster
 * can read the payroll.
 */
export const GET = apiHandler(
  { auth: true, permissions: "employees.read", query: listEmployeesSchema, branch: "query" },
  async ({ query, auth }) =>
    ok(await listEmployees({ ...query, includeSalary: can(auth, "employees.view_salary") })),
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "employees.create",
    body: createEmployeeSchema,
    branch: "body",
    rateLimit: RateLimits.write,
  },
  async ({ body, auth }) => created(await createEmployee(body, auth)),
);
