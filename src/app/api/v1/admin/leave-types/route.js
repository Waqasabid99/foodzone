import { z } from "zod";
import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { leaveTypeSchema } from "@/server/validation/hr.schemas";
import { createLeaveType, listLeaveTypes } from "@/server/services/leave.service";

const querySchema = z.object({ isActive: z.stringbool().optional() });

export const GET = apiHandler(
  { auth: true, permissions: "leave_types.read", query: querySchema },
  async ({ query }) => ok(await listLeaveTypes(query)),
);

/** `annualQuota: 0` means unlimited — sick leave, in many places. */
export const POST = apiHandler(
  { auth: true, permissions: "leave_types.manage", body: leaveTypeSchema, rateLimit: RateLimits.write },
  async ({ body, auth }) => created(await createLeaveType(body, auth)),
);
