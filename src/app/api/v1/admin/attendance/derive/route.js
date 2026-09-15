import { apiHandler, ok, RateLimits } from "@/lib/api";
import { deriveAttendanceSchema } from "@/server/validation/hr.schemas";
import { deriveRange } from "@/server/services/attendance.service";

/**
 * Folds punches into days.
 *
 * Idempotent: the same punches produce the same day, so this is safe nightly,
 * on demand, and again after a re-sync. Days a supervisor has corrected are
 * skipped unless `force` is set — a correction that evaporates on the next run
 * is worse than none at all.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "attendance.edit",
    body: deriveAttendanceSchema,
    branch: "body",
    rateLimit: RateLimits.write,
  },
  async ({ body }) => ok(await deriveRange(body)),
);
