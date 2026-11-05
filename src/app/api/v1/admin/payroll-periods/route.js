import { apiHandler, branchScope, created, ok, RateLimits } from "@/lib/api";
import { createPayrollPeriodSchema, listPayrollSchema } from "@/server/validation/hr.schemas";
import { createPayrollPeriod, listPayrollPeriods } from "@/server/services/payroll.service";

export const GET = apiHandler(
  { auth: true, permissions: "payroll.read", query: listPayrollSchema, branch: "query" },
  async ({ query, auth }) => ok(await listPayrollPeriods({ ...query, scope: branchScope(auth, "payroll.read") })),
);

/** Overlapping periods are refused — they would pay the same day twice. */
export const POST = apiHandler(
  { auth: true, permissions: "payroll.process", body: createPayrollPeriodSchema, rateLimit: RateLimits.write },
  async ({ body, auth }) => created(await createPayrollPeriod(body, auth)),
);
