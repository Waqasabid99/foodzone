import { apiHandler, branchScope, created, ok, RateLimits } from "@/lib/api";
import { assignShiftSchema, rosterQuerySchema } from "@/server/validation/hr.schemas";
import { assignShift, roster } from "@/server/services/shift.service";
import { assertRecordAccess } from "@/server/hr/access";

export const GET = apiHandler(
  { auth: true, permissions: "rosters.read", query: rosterQuerySchema, branch: "query" },
  async ({ query, auth }) => ok(await roster({ ...query, scope: branchScope(auth, "rosters.read") })),
);

/**
 * Rosters an employee across a date range, upserting per day.
 *
 * Rostering is iterative — a manager publishes a week then moves three people —
 * so a second call for the same date is a correction, not a duplicate. The
 * employee decides the branch: a manager may only roster their own staff.
 */
export const POST = apiHandler(
  { auth: true, permissions: "rosters.manage", body: assignShiftSchema, rateLimit: RateLimits.write },
  async ({ body, auth }) => {
    await assertRecordAccess(auth, "employee", body.employeeId, "rosters.manage");
    return created(await assignShift({ ...body, actor: auth }));
  },
);
