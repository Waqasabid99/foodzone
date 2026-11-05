import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { correctAttendanceSchema } from "@/server/validation/hr.schemas";
import { correctAttendanceDay } from "@/server/services/attendance.service";
import { assertRecordAccess } from "@/server/hr/access";

/**
 * A supervisor saying the derivation got it wrong.
 *
 * Requires a reason, resets any approval, and is not overwritten by a later
 * re-derivation.
 */
export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "attendance.edit",
    params: idParamSchema,
    body: correctAttendanceSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => {
    await assertRecordAccess(auth, "attendanceDay", params.id, "attendance.edit");
    return ok(await correctAttendanceDay(params.id, body, auth));
  },
);
