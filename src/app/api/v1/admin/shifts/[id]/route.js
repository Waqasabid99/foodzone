import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateShiftSchema } from "@/server/validation/hr.schemas";
import { getShift, updateShift } from "@/server/services/shift.service";

export const GET = apiHandler(
  { auth: true, permissions: "shifts.read", params: idParamSchema },
  async ({ params }) => ok(await getShift(params.id)),
);

/**
 * Retiming a shift that has been worked is refused: somebody on time would
 * become late and a full day would become a half day. Create a new shift.
 */
export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "shifts.manage",
    params: idParamSchema,
    body: updateShiftSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await updateShift(params.id, body, auth)),
);
