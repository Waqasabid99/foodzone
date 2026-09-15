import { apiHandler, ok, RateLimits } from "@/lib/api";
import { approveAttendanceSchema } from "@/server/validation/hr.schemas";
import { approveAttendance } from "@/server/services/attendance.service";

/**
 * Signs off attendance for payroll.
 *
 * Payroll pays what was approved, not what the terminal recorded — which is the
 * point of having somebody look at a `MISSING_PUNCH` before an employee loses a
 * day's pay to a flat battery. Approving those is allowed and reported, because
 * sometimes the right answer really is "they were here, the device broke".
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "attendance.approve",
    body: approveAttendanceSchema,
    branch: "body",
    rateLimit: RateLimits.write,
  },
  async ({ body, auth }) => ok(await approveAttendance({ ...body, actor: auth })),
);
