import { apiHandler, ok, RateLimits } from "@/lib/api";
import { claimPunchesSchema } from "@/server/validation/hr.schemas";
import { claimUnmatchedPunches } from "@/server/services/punch.service";
import { assertRecordAccess } from "@/server/hr/access";

/**
 * Links orphaned punches to an employee and enrols the id.
 *
 * The punches were always real; this is what makes them count. They are marked
 * unprocessed again so the days they land on get re-derived.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "employees.update",
    body: claimPunchesSchema,
    rateLimit: RateLimits.write,
  },
  async ({ body, auth }) => {
    await assertRecordAccess(auth, "employee", body.employeeId, "employees.update");
    return ok(await claimUnmatchedPunches({ ...body, actor: auth }));
  },
);
