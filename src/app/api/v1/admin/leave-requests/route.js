import { apiHandler, branchScope, created, ok, RateLimits } from "@/lib/api";
import { listLeaveSchema, requestLeaveSchema } from "@/server/validation/hr.schemas";
import { listLeaveRequests, requestLeave } from "@/server/services/leave.service";
import { assertRecordAccess } from "@/server/hr/access";

export const GET = apiHandler(
  { auth: true, permissions: "leave_requests.read", query: listLeaveSchema, branch: "query" },
  async ({ query, auth }) => ok(await listLeaveRequests({ ...query, scope: branchScope(auth, "leave_requests.read") })),
);

/** Overlapping requests are refused: two leaves over one day consume two. */
export const POST = apiHandler(
  { auth: true, permissions: "leave_requests.create", body: requestLeaveSchema, rateLimit: RateLimits.write },
  async ({ body, auth }) => {
    await assertRecordAccess(auth, "employee", body.employeeId, "leave_requests.create");
    return created(await requestLeave(body, auth));
  },
);
