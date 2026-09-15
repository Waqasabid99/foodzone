import { apiHandler, noContent, ok, RateLimits } from "@/lib/api";
import { idParamSchema, updateRoleSchema } from "@/server/validation/schemas";
import { deleteRole, getRole, updateRole } from "@/server/services/role.service";

export const GET = apiHandler(
  { auth: true, permissions: "roles.read", params: idParamSchema },
  async ({ params }) => ok(await getRole(params.id)),
);

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "roles.update",
    params: idParamSchema,
    body: updateRoleSchema,
    rateLimit: RateLimits.write,
    audit: { action: "role.update", entityType: "Role" },
  },
  async ({ auth, params, body }) => ok(await updateRole(params.id, body, auth)),
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "roles.delete",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "role.delete", entityType: "Role" },
  },
  async ({ auth, params }) => {
    await deleteRole(params.id, auth);
    return noContent();
  },
);
