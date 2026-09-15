import { apiHandler, ok } from "@/lib/api";
import { getCurrentUser } from "@/server/services/auth.service";

/** Restores the session on app launch, and is how a client learns its permissions. */
export const GET = apiHandler({ auth: true }, async ({ auth }) => ok(await getCurrentUser({ principal: auth })));
