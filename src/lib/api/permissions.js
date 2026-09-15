import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/api/errors";

/**
 * RBAC resolution.
 *
 * A user's effective permissions come from three places, in this order of
 * authority:
 *
 *   1. `User.isSuperAdmin` — bypasses everything. Bootstrap account only.
 *   2. `UserPermissionOverride` with effect DENY — beats any role grant.
 *   3. Role grants, plus overrides with effect ALLOW.
 *
 * Every grant may be global (`branchId: null`, meaning all branches) or pinned
 * to one branch, which is why `can()` takes a branch context: the same user can
 * be a manager at one outlet and a cashier at another.
 *
 * Permissions are resolved per request rather than baked into the access token.
 * A token that carried them would outlive the grant — revoke a role and the
 * user keeps their access until the token expires. The cost is a query, which
 * a short in-process cache absorbs.
 */

const cache = new Map();

function cacheKey(userId, sessionId) {
  return `${userId}:${sessionId ?? "-"}`;
}

function ttlMs() {
  return env().PERMISSION_CACHE_TTL_SECONDS * 1000;
}

/**
 * Loads the acting user, their roles and their permission grants.
 *
 * Returns null when the account cannot act at all — deleted, suspended, or its
 * session was revoked — so the caller answers 401 rather than leaking why.
 */
export async function loadPrincipal({ userId, sessionId = null, issuedAt = null }) {
  const key = cacheKey(userId, sessionId);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return isStillValid(hit.principal, issuedAt) ? hit.principal : null;
  }

  const now = new Date();
  const notExpired = { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };

  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      isSuperAdmin: true,
      tokensValidFrom: true,
      roleAssignments: {
        where: notExpired,
        select: {
          branchId: true,
          role: {
            select: {
              key: true,
              name: true,
              scope: true,
              level: true,
              permissions: { select: { permission: { select: { key: true } } } },
            },
          },
        },
      },
      permissionOverrides: {
        where: notExpired,
        select: { effect: true, branchId: true, permission: { select: { key: true } } },
      },
    },
  });

  // PENDING_VERIFICATION accounts hold a valid session: they may browse and
  // build a cart, and are blocked at the actions that require a verified
  // address (see `requireVerifiedEmail`). SUSPENDED and DEACTIVATED cannot act
  // at all.
  if (!user || !["ACTIVE", "PENDING_VERIFICATION"].includes(user.status)) return null;

  // A revoked session must stop working even though its access token is still
  // cryptographically valid. Checked here, inside the cached load, so the cost
  // is one query per cache window rather than one per request.
  if (sessionId) {
    const session = await prisma.refreshToken.findUnique({
      where: { id: sessionId },
      select: { revokedAt: true, userId: true },
    });
    if (!session || session.userId !== user.id || session.revokedAt) return null;
  }

  const principal = buildPrincipal(user, sessionId);
  cache.set(key, { principal, expiresAt: Date.now() + ttlMs() });

  return isStillValid(principal, issuedAt) ? principal : null;
}

/**
 * Tokens minted before `tokensValidFrom` are dead: this is the force-logout
 * switch used on password reset and account compromise.
 */
function isStillValid(principal, issuedAt) {
  if (!issuedAt || !principal.tokensValidFrom) return true;
  // `iat` is whole seconds, so round the boundary down to avoid killing a token
  // minted in the same second as the reset.
  return issuedAt >= Math.floor(principal.tokensValidFrom.getTime() / 1000);
}

function buildPrincipal(user, sessionId) {
  /** permission key -> set of branch ids the grant covers (null = all branches) */
  const allow = new Map();
  const deny = new Map();

  const add = (map, key, branchId) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(branchId ?? null);
  };

  for (const assignment of user.roleAssignments) {
    for (const { permission } of assignment.role.permissions) {
      add(allow, permission.key, assignment.branchId);
    }
  }

  for (const override of user.permissionOverrides) {
    add(override.effect === "DENY" ? deny : allow, override.permission.key, override.branchId);
  }

  const roles = user.roleAssignments.map((assignment) => ({
    key: assignment.role.key,
    name: assignment.role.name,
    scope: assignment.role.scope,
    level: assignment.role.level,
    branchId: assignment.branchId,
  }));

  return {
    userId: user.id,
    sessionId,
    name: user.name,
    email: user.email,
    phone: user.phone,
    status: user.status,
    emailVerified: Boolean(user.emailVerifiedAt),
    phoneVerified: Boolean(user.phoneVerifiedAt),
    isSuperAdmin: user.isSuperAdmin,
    tokensValidFrom: user.tokensValidFrom,
    roles,
    /// Branches this user holds any role at. Null in the list means every branch.
    branchIds: [...new Set(user.roleAssignments.map((a) => a.branchId))],
    // Lowest number is the most senior role held; governs which roles they may grant.
    level: roles.length ? Math.min(...roles.map((role) => role.level)) : Number.MAX_SAFE_INTEGER,
    allow,
    deny,
  };
}

function matches(map, key, branchId) {
  const branches = map.get(key);
  if (!branches) return false;
  // A global grant (null) covers every branch.
  if (branches.has(null)) return true;
  // Without a branch context, any branch-scoped grant counts.
  if (branchId === undefined || branchId === null) return branches.size > 0;
  return branches.has(branchId);
}

/** True when the principal may perform `permissionKey`, optionally at a branch. */
export function can(principal, permissionKey, { branchId } = {}) {
  if (!principal) return false;
  if (principal.isSuperAdmin) return true;
  // DENY wins over every ALLOW, at the same branch or globally.
  if (matches(principal.deny, permissionKey, branchId)) return false;
  return matches(principal.allow, permissionKey, branchId);
}

export function canAll(principal, keys, options) {
  return keys.every((key) => can(principal, key, options));
}

export function canAny(principal, keys, options) {
  return keys.some((key) => can(principal, key, options));
}

export function hasRole(principal, roleKeys) {
  if (!principal) return false;
  if (principal.isSuperAdmin) return true;
  const wanted = Array.isArray(roleKeys) ? roleKeys : [roleKeys];
  return principal.roles.some((role) => wanted.includes(role.key));
}

/**
 * Throws 403 when the check fails. `any: true` passes if one of the keys is
 * held, otherwise all of them are required.
 */
export function assertPermission(principal, keys, { branchId, any = false } = {}) {
  const required = Array.isArray(keys) ? keys : [keys];
  if (required.length === 0) return;

  const granted = any ? canAny(principal, required, { branchId }) : canAll(principal, required, { branchId });
  if (granted) return;

  throw ApiError.forbidden("You do not have permission to perform this action", {
    required,
    ...(branchId ? { branchId } : {}),
  });
}

export function assertRole(principal, roleKeys) {
  if (hasRole(principal, roleKeys)) return;
  throw ApiError.forbidden("Your role does not allow this action");
}

/** Every permission key the principal effectively holds, for `/auth/me`. */
export function grantedPermissionKeys(principal, { branchId } = {}) {
  if (!principal) return [];
  if (principal.isSuperAdmin) return ["*"];

  return [...principal.allow.keys()].filter((key) => can(principal, key, { branchId })).sort();
}

/**
 * Call after changing a user's roles, overrides or status, and on logout.
 * Without it the change waits out the cache TTL — acceptable for a grant,
 * not for a revocation.
 *
 * This clears the cache of ONE server instance. Behind several instances,
 * revocation still converges within the TTL; treat that window as the security
 * budget, and keep the TTL short.
 */
export function invalidatePrincipal(userId) {
  for (const key of cache.keys()) {
    if (key.startsWith(`${userId}:`)) cache.delete(key);
  }
}

export function invalidateAllPrincipals() {
  cache.clear();
}
