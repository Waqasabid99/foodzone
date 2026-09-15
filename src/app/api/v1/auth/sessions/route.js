import { apiHandler, ok, clearSessionCookies } from "@/lib/api";
import { listSessions, logout } from "@/server/services/auth.service";

/** "Where am I signed in" — one row per device holding a live refresh token. */
export const GET = apiHandler({ auth: true }, async ({ auth }) =>
  ok(await listSessions({ userId: auth.userId, currentSessionId: auth.sessionId })),
);

/** Sign out everywhere, including this device. */
export const DELETE = apiHandler({ auth: true }, async ({ auth }) => {
  const result = await logout({ userId: auth.userId, allDevices: true });
  return clearSessionCookies(ok(result));
});
