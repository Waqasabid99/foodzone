import { apiHandler, ok, RateLimits } from "@/lib/api";
import { assignRoleSchema, idParamSchema } from "@/server/validation/schemas";
import { assignRole, listUserRoles } from "@/server/services/role.service";

export const GET = apiHandler(
  { auth: true, permissions: "users.read", params: idParamSchema },
  async ({ params }) => ok(await listUserRoles(params.id)),
);

/** Grants a role, optionally scoped to one branch. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "roles.assign",
    params: idParamSchema,
    body: assignRoleSchema,
    rateLimit: RateLimits.write,
    audit: { action: "user.role_assign", entityType: "User" },
  },
  async ({ auth, params, body }) => ok(await assignRole({ userId: params.id, ...body }, auth)),
);
