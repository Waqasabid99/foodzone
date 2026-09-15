import { apiHandler, created, RateLimits } from "@/lib/api";
import { manualPunchSchema } from "@/server/validation/hr.schemas";
import { addManualPunch } from "@/server/services/punch.service";

/**
 * A punch typed by a supervisor.
 *
 * The correction path: derivation treats it like any other punch, but it is
 * marked MANUAL and carries who added it — vouching for somebody's hours should
 * have a name against it.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "attendance_punches.create_manual",
    body: manualPunchSchema,
    rateLimit: RateLimits.write,
  },
  async ({ body, auth }) => created(await addManualPunch({ ...body, actor: auth })),
);
