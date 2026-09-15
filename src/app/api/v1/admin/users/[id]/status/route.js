import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema, setUserStatusSchema } from "@/server/validation/schemas";
import { setUserStatus } from "@/server/services/user.service";

/** Suspend or reactivate. Suspension revokes every session immediately. */
export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "users.suspend",
    params: idParamSchema,
    body: setUserStatusSchema,
    rateLimit: RateLimits.write,
    audit: { action: "user.status_change", entityType: "User" },
  },
  async ({ auth, params, body }) => ok(await setUserStatus(params.id, body, auth)),
);
