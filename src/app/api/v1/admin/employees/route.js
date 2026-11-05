import { apiHandler, branchScope, created, ok, RateLimits } from "@/lib/api";
import { createEmployeeSchema, listEmployeesSchema } from "@/server/validation/hr.schemas";
import { createEmployee, listEmployees } from "@/server/services/employee.service";
import { salaryVisible, withoutPay } from "@/server/hr/access";

/**
 * Staff at the caller's own branches, with pay only where they may see it.
 *
 * Two separate scopes: `employees.read` decides whose names appear, and
 * `employees.view_salary` decides whose figures do. A shift supervisor needs
 * the first and must not have the second — one permission for both means
 * whoever builds the roster can read the payroll. Asked per row rather than
 * once, because a list can span branches where only one of the two is held.
 */
export const GET = apiHandler(
  { auth: true, permissions: "employees.read", query: listEmployeesSchema, branch: "query" },
  async ({ query, auth }) => {
    const page = await listEmployees({
      ...query,
      scope: branchScope(auth, "employees.read"),
      includeSalary: true,
    });
    return ok({
      ...page,
      items: page.items.map((row) => (salaryVisible(auth, row.branchId) ? row : withoutPay(row))),
    });
  },
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
