import { apiHandler, ok, RateLimits } from "@/lib/api";
import { removeAssignmentSchema } from "@/server/validation/hr.schemas";
import { removeAssignment } from "@/server/services/shift.service";

export const DELETE = apiHandler(
  { auth: true, permissions: "rosters.manage", body: removeAssignmentSchema, rateLimit: RateLimits.write },
  async ({ body, auth }) => ok(await removeAssignment({ ...body, actor: auth })),
);
