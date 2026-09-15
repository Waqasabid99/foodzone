import { ApiError } from "@/lib/api/errors";
import { readAccessToken } from "@/lib/api/cookies";
import { verifyAccessToken } from "@/lib/api/tokens";
import { loadPrincipal, assertPermission, assertRole, can, hasRole } from "@/lib/api/permissions";

/**
 * Resolves the caller from either transport — `Authorization: Bearer` for the
 * mobile app, httpOnly cookie for the website — and loads their roles and
 * permissions.
 *
 * Returns null when unauthenticated, so public endpoints can personalise
 * without branching on an exception. Use `requireAuth` when a caller is
 * mandatory.
 */
export async function getAuthContext(request) {
  const token = await readAccessToken(request);
  if (!token) return null;

  const claims = verifyAccessToken(token);
  if (!claims?.userId) return null;

  return loadPrincipal(claims);
}

export async function requireAuth(request) {
  const principal = await getAuthContext(request);
  if (!principal) throw ApiError.unauthorized();
  return principal;
}

/**
 * Convenience for endpoints that are public but richer when signed in
 * (a menu that marks the viewer's favourites, say).
 */
export async function optionalAuth(request) {
  try {
    return await getAuthContext(request);
  } catch {
    return null;
  }
}

export async function requirePermission(request, keys, options) {
  const principal = await requireAuth(request);
  assertPermission(principal, keys, options);
  return principal;
}

export async function requireRole(request, roleKeys) {
  const principal = await requireAuth(request);
  assertRole(principal, roleKeys);
  return principal;
}

/**
 * Branch scoping for staff endpoints.
 *
 * A user with a global grant may act at any branch; a branch-scoped user may
 * act only where they hold the role. Returns the branch id so the caller can
 * use it directly in the query.
 */
export function assertBranchAccess(principal, branchId, permissionKey) {
  if (!branchId) throw ApiError.validation("A branch must be specified");
  if (principal.isSuperAdmin) return branchId;

  if (permissionKey && !can(principal, permissionKey, { branchId })) {
    throw ApiError.forbidden("You do not have permission at this branch", {
      required: [permissionKey],
      branchId,
    });
  }

  const scoped = principal.branchIds;
  // A null entry means a grant that spans every branch.
  if (scoped.includes(null) || scoped.includes(branchId)) return branchId;

  throw ApiError.forbidden("You do not have access to this branch", { branchId });
}

/**
 * Blocks actions that need a reachable email address — checkout above all.
 *
 * PENDING_VERIFICATION accounts hold a valid session on purpose, so this is the
 * gate that makes that safe. `details.reason` lets a client show the "verify
 * your email" prompt instead of a generic permission error.
 */
export function requireVerifiedEmail(principal) {
  if (principal?.emailVerified) return;
  throw ApiError.forbidden("Verify your email address to continue", { reason: "EMAIL_NOT_VERIFIED" });
}

/** True when the record belongs to the caller — the ownership half of RBAC. */
export function isOwner(principal, resourceUserId) {
  return Boolean(principal && resourceUserId && principal.userId === resourceUserId);
}

/**
 * Ownership OR a permission: "you may read your own order, or any order if you
 * hold orders.read". The pattern every self-service endpoint needs.
 */
export function assertOwnerOrPermission(principal, resourceUserId, permissionKey, options) {
  if (isOwner(principal, resourceUserId)) return;
  assertPermission(principal, permissionKey, options);
}

export { can, hasRole, assertPermission, assertRole };
