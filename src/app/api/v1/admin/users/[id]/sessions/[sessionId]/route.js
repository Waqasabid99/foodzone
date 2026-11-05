import { z } from "zod";
import { apiHandler, ok, RateLimits } from "@/lib/api";
import { cuidSchema } from "@/server/validation/schemas";
import { revokeSessions } from "@/server/services/user.service";

const paramsSchema = z.object({ id: cuidSchema, sessionId: cuidSchema });

/** Signs one device out, leaving the others alone. */
export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "users.manage_sessions",
    params: paramsSchema,
    rateLimit: RateLimits.write,
    audit: { action: "user.session_revoked", entityType: "User" },
  },
  async ({ auth, params }) => ok(await revokeSessions(params.id, { sessionId: params.sessionId, actor: auth })),
);
