import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { revokeSession } from "@/server/services/auth.service";

/** Revokes one device. Scoped to the caller's own sessions by the service. */
export const DELETE = apiHandler({ auth: true, params: idParamSchema }, async ({ auth, params }) =>
  ok(await revokeSession({ userId: auth.userId, sessionId: params.id })),
);
