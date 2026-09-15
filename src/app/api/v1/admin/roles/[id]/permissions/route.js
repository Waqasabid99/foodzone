import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema, setRolePermissionsSchema } from "@/server/validation/schemas";
import { setRolePermissions } from "@/server/services/role.service";

/**
 * Replaces the role's permission set. PUT rather than POST because the body is
 * the complete list — sending a shorter list revokes the difference.
 */
export const PUT = apiHandler(
  {
    auth: true,
    permissions: "roles.update",
    params: idParamSchema,
    body: setRolePermissionsSchema,
    rateLimit: RateLimits.write,
    audit: { action: "role.set_permissions", entityType: "Role" },
  },
  async ({ auth, params, body }) => ok(await setRolePermissions(params.id, body.permissionKeys, auth)),
);
