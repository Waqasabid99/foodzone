/**
 * @deprecated Import from "@/lib/api" instead.
 *
 * Kept so existing route handlers keep working while they are migrated onto
 * `apiHandler`. The role check now goes through RBAC rather than the old
 * `User.role` enum, which no longer exists.
 */
import { ApiError } from "@/lib/api/errors";
import { requireAuth } from "@/lib/api/auth";
import { hasRole } from "@/lib/api/permissions";

export { getAuthContext, requireAuth, optionalAuth } from "@/lib/api/auth";
export {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  setSessionCookies,
  clearSessionCookies,
  readRefreshToken,
} from "@/lib/api/cookies";

export async function requireAdmin(request) {
  const principal = await requireAuth(request);
  if (!hasRole(principal, ["admin", "super-admin"])) throw ApiError.forbidden();
  return principal;
}
