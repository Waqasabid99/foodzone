import { apiHandler, ok, RateLimits } from "@/lib/api";
import { z } from "zod";
import { removeUserOverride } from "@/server/services/role.service";

const paramsSchema = z.object({ id: z.string().min(1), overrideId: z.string().min(1) });

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "roles.assign",
    params: paramsSchema,
    rateLimit: RateLimits.write,
    audit: { action: "user.permission_override_remove", entityType: "User" },
  },
  async ({ auth, params }) => ok(await removeUserOverride({ userId: params.id, overrideId: params.overrideId }, auth)),
);
