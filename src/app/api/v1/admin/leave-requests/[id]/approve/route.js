import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { reviewLeaveSchema } from "@/server/validation/hr.schemas";
import { approveLeave } from "@/server/services/leave.service";

/**
 * Approval is the commitment, so it is when the balance is consumed.
 *
 * The check and the decrement run in one transaction, so two approvals racing
 * cannot both pass a check that each was the last day. Attendance days the
 * leave covers are re-derived afterwards — a day already marked ABSENT has to
 * become ON_LEAVE, or the employee is docked for leave that was granted.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "leave_requests.approve",
    params: idParamSchema,
    body: reviewLeaveSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await approveLeave(params.id, { note: body.note, actor: auth })),
);
