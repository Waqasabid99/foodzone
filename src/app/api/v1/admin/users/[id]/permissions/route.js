import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema, setOverrideSchema } from "@/server/validation/schemas";
import { listUserOverrides, setUserOverride } from "@/server/services/role.service";

export const GET = apiHandler(
  { auth: true, permissions: "users.read", params: idParamSchema },
  async ({ params }) => ok(await listUserOverrides(params.id)),
);

/** A single extra allow or deny on top of this user's roles. DENY always wins. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "roles.assign",
    params: idParamSchema,
    body: setOverrideSchema,
    rateLimit: RateLimits.write,
    audit: { action: "user.permission_override", entityType: "User" },
  },
  async ({ auth, params, body }) => ok(await setUserOverride({ userId: params.id, ...body }, auth)),
);
