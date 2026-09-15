import { apiHandler, ok, RateLimits } from "@/lib/api";
import { z } from "zod";
import { revokeRole } from "@/server/services/role.service";

const paramsSchema = z.object({ id: z.string().min(1), assignmentId: z.string().min(1) });

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "roles.assign",
    params: paramsSchema,
    rateLimit: RateLimits.write,
    audit: { action: "user.role_revoke", entityType: "User" },
  },
  async ({ auth, params }) => ok(await revokeRole({ userId: params.id, assignmentId: params.assignmentId }, auth)),
);
