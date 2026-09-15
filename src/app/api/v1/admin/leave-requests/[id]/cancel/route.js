import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { reviewLeaveSchema } from "@/server/validation/hr.schemas";
import { cancelLeave } from "@/server/services/leave.service";

/** Only approved leave returns days — a pending request never consumed any. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "leave_requests.cancel",
    params: idParamSchema,
    body: reviewLeaveSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await cancelLeave(params.id, { reason: body.note, actor: auth })),
);
