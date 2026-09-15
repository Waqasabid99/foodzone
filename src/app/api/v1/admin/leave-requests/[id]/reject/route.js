import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { reviewLeaveSchema } from "@/server/validation/hr.schemas";
import { rejectLeave } from "@/server/services/leave.service";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "leave_requests.reject",
    params: idParamSchema,
    body: reviewLeaveSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await rejectLeave(params.id, { note: body.note, actor: auth })),
);
