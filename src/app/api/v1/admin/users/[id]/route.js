import { apiHandler, noContent, ok, RateLimits } from "@/lib/api";
import { idParamSchema, updateUserSchema } from "@/server/validation/schemas";
import { deleteUser, getUser, updateUser } from "@/server/services/user.service";

export const GET = apiHandler(
  { auth: true, permissions: "users.read", params: idParamSchema },
  async ({ params }) => ok(await getUser(params.id)),
);

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "users.update",
    params: idParamSchema,
    body: updateUserSchema,
    rateLimit: RateLimits.write,
    audit: { action: "user.update", entityType: "User" },
  },
  async ({ auth, params, body }) => ok(await updateUser(params.id, body, auth)),
);

/** Soft delete: the row survives because orders and audit entries reference it. */
export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "users.delete",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "user.delete", entityType: "User" },
  },
  async ({ auth, params }) => {
    await deleteUser(params.id, auth);
    return noContent();
  },
);
