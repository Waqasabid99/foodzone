import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateLeaveTypeSchema } from "@/server/validation/hr.schemas";
import { updateLeaveType } from "@/server/services/leave.service";

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "leave_types.manage",
    params: idParamSchema,
    body: updateLeaveTypeSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await updateLeaveType(params.id, body, auth)),
);
