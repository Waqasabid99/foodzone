import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { listLeaveSchema, requestLeaveSchema } from "@/server/validation/hr.schemas";
import { listLeaveRequests, requestLeave } from "@/server/services/leave.service";

export const GET = apiHandler(
  { auth: true, permissions: "leave_requests.read", query: listLeaveSchema, branch: "query" },
  async ({ query }) => ok(await listLeaveRequests(query)),
);

/** Overlapping requests are refused: two leaves over one day consume two. */
export const POST = apiHandler(
  { auth: true, permissions: "leave_requests.create", body: requestLeaveSchema, rateLimit: RateLimits.write },
  async ({ body, auth }) => created(await requestLeave(body, auth)),
);
