import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { reviewLeaveSchema } from "@/server/validation/hr.schemas";
import { cancelLeave } from "@/server/services/leave.service";
import { assertRecordAccess } from "@/server/hr/access";

/** Only approved leave returns days — a pending request never consumed any. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "leave_requests.cancel",
    params: idParamSchema,
    body: reviewLeaveSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => {
    await assertRecordAccess(auth, "leaveRequest", params.id, "leave_requests.cancel");
    return ok(await cancelLeave(params.id, { reason: body.note, actor: auth }));
  },
);
