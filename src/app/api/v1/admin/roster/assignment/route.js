import { apiHandler, ok, RateLimits } from "@/lib/api";
import { removeAssignmentSchema } from "@/server/validation/hr.schemas";
import { removeAssignment } from "@/server/services/shift.service";
import { assertRecordAccess } from "@/server/hr/access";

export const DELETE = apiHandler(
  { auth: true, permissions: "rosters.manage", body: removeAssignmentSchema, rateLimit: RateLimits.write },
  async ({ body, auth }) => {
    await assertRecordAccess(auth, "employee", body.employeeId, "rosters.manage");
    return ok(await removeAssignment({ ...body, actor: auth }));
  },
);
