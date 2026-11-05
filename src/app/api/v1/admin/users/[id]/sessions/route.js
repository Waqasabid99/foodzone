import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { listSessions, revokeSessions } from "@/server/services/user.service";

/** Where this account is signed in. The tokens themselves are never shown. */
export const GET = apiHandler(
  { auth: true, permissions: "users.manage_sessions", params: idParamSchema },
  async ({ params }) => ok(await listSessions(params.id)),
);

/** Signs the account out everywhere, access tokens included. */
export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "users.manage_sessions",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "user.sessions_revoked", entityType: "User" },
  },
  async ({ auth, params }) => ok(await revokeSessions(params.id, { actor: auth })),
);
