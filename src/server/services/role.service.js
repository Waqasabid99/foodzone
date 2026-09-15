import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { can, invalidatePrincipal } from "@/lib/api/permissions";
import { slugify } from "@/lib/slug";

/**
 * Role and permission administration.
 *
 * Two invariants are enforced here rather than by permissions alone, because
 * `roles.create` and `roles.assign` on their own would let any role admin
 * promote themselves to owner:
 *
 *   1. You cannot grant a permission you do not hold yourself.
 *   2. You cannot create or grant a role more senior than your own.
 *
 * A super admin bypasses both. `level` is seniority — lower is more senior.
 */

function assertNotSystemRole(role, action) {
  if (!role.isSystem) return;
  throw ApiError.forbidden(
    `"${role.name}" is a system role and cannot be ${action}. Create a new role instead.`,
    { roleKey: role.key },
  );
}

/** Rule 1: no granting what you do not hold. */
export function assertCanGrantPermissions(actor, permissionKeys, { branchId } = {}) {
  if (actor.isSuperAdmin) return;

  const missing = permissionKeys.filter((key) => !can(actor, key, { branchId }));
  if (missing.length) {
    throw ApiError.forbidden("You cannot grant permissions you do not hold yourself", { missing });
  }
}

/** Rule 2: no creating or granting a role at or above your own seniority. */
export function assertCanGrantRole(actor, role) {
  if (actor.isSuperAdmin) return;

  if (role.level <= actor.level) {
    throw ApiError.forbidden("You cannot grant a role at or above your own level", {
      roleLevel: role.level,
      yourLevel: actor.level,
    });
  }
}

export async function listPermissions() {
  const permissions = await prisma.permission.findMany({
    orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
  });

  // Grouped by module: that is how the role editor renders it, and it saves
  // every client re-implementing the grouping.
  const modules = new Map();
  for (const permission of permissions) {
    if (!modules.has(permission.module)) modules.set(permission.module, []);
    modules.get(permission.module).push({
      id: permission.id,
      key: permission.key,
      action: permission.action,
      label: permission.label,
      description: permission.description,
    });
  }

  return {
    total: permissions.length,
    modules: [...modules.entries()].map(([module, items]) => ({ module, permissions: items })),
  };
}

export async function listRoles({ includeSystem = true } = {}) {
  const roles = await prisma.role.findMany({
    where: includeSystem ? {} : { isSystem: false },
    orderBy: [{ level: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { permissions: true, assignments: true } },
    },
  });

  return roles.map(toRoleSummary);
}

function toRoleSummary(role) {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    scope: role.scope,
    level: role.level,
    isSystem: role.isSystem,
    permissionCount: role._count?.permissions ?? role.permissions?.length ?? 0,
    userCount: role._count?.assignments ?? 0,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

export async function getRole(roleId) {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    include: {
      permissions: { include: { permission: true } },
      _count: { select: { assignments: true } },
    },
  });
  if (!role) throw ApiError.notFound("Role not found");

  return {
    ...toRoleSummary(role),
    permissionCount: role.permissions.length,
    permissions: role.permissions
      .map(({ permission }) => ({
        id: permission.id,
        key: permission.key,
        module: permission.module,
        label: permission.label,
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  };
}

async function resolvePermissionIds(permissionKeys) {
  if (!permissionKeys?.length) return [];

  const permissions = await prisma.permission.findMany({
    where: { key: { in: permissionKeys } },
    select: { id: true, key: true },
  });

  const found = new Set(permissions.map((permission) => permission.key));
  const unknown = permissionKeys.filter((key) => !found.has(key));
  if (unknown.length) {
    // Permissions are seeded, never authored, so an unknown key is a typo or a
    // stale client — worth rejecting loudly.
    throw ApiError.validation("Unknown permission keys", { permissionKeys: unknown });
  }

  return permissions.map((permission) => permission.id);
}

export async function createRole({ name, description, scope = "BRANCH", level, permissionKeys = [] }, actor) {
  const key = slugify(name);
  if (!key) throw ApiError.validation("Role name must contain letters or numbers", { name: ["Invalid name"] });

  // A role you could not be granted yourself is a role you could use to
  // escalate, so its level must sit below yours.
  const resolvedLevel = level ?? Math.max(actor.level + 10, 50);
  assertCanGrantRole(actor, { level: resolvedLevel });
  assertCanGrantPermissions(actor, permissionKeys);

  const existing = await prisma.role.findUnique({ where: { key }, select: { id: true } });
  if (existing) throw ApiError.conflict(`A role named "${name}" already exists`);

  const permissionIds = await resolvePermissionIds(permissionKeys);

  const role = await prisma.role.create({
    data: {
      key,
      name: name.trim(),
      description,
      scope,
      level: resolvedLevel,
      isSystem: false,
      createdById: actor.userId,
      permissions: {
        create: permissionIds.map((permissionId) => ({ permissionId, grantedById: actor.userId })),
      },
    },
  });

  return getRole(role.id);
}

export async function updateRole(roleId, { name, description, scope, level }, actor) {
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) throw ApiError.notFound("Role not found");
  assertNotSystemRole(role, "edited");
  assertCanGrantRole(actor, role);
  if (level !== undefined) assertCanGrantRole(actor, { level });

  await prisma.role.update({
    where: { id: roleId },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(scope !== undefined ? { scope } : {}),
      ...(level !== undefined ? { level } : {}),
    },
  });

  // Anyone holding this role may have gained or lost reach.
  await invalidateRoleHolders(roleId);
  return getRole(roleId);
}

export async function setRolePermissions(roleId, permissionKeys, actor) {
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) throw ApiError.notFound("Role not found");
  assertNotSystemRole(role, "changed");
  assertCanGrantRole(actor, role);
  assertCanGrantPermissions(actor, permissionKeys);

  const permissionIds = await resolvePermissionIds(permissionKeys);

  await prisma.$transaction([
    // Replace rather than merge: removing a key from the list must revoke it.
    prisma.rolePermission.deleteMany({ where: { roleId, permissionId: { notIn: permissionIds } } }),
    prisma.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({ roleId, permissionId, grantedById: actor.userId })),
      skipDuplicates: true,
    }),
  ]);

  await invalidateRoleHolders(roleId);
  return getRole(roleId);
}

export async function deleteRole(roleId, actor) {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    include: { _count: { select: { assignments: true } } },
  });
  if (!role) throw ApiError.notFound("Role not found");
  assertNotSystemRole(role, "deleted");
  assertCanGrantRole(actor, role);

  if (role._count.assignments > 0) {
    throw ApiError.conflict(
      `${role._count.assignments} user(s) still hold this role. Reassign them before deleting it.`,
    );
  }

  await prisma.role.delete({ where: { id: roleId } });
  return { deleted: true };
}

// --- assignments ----------------------------------------------------------

export async function listUserRoles(userId) {
  const assignments = await prisma.userRoleAssignment.findMany({
    where: { userId },
    include: {
      role: { select: { id: true, key: true, name: true, scope: true, level: true } },
      branch: { select: { id: true, name: true, code: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return assignments.map((assignment) => ({
    id: assignment.id,
    role: assignment.role,
    branch: assignment.branch,
    expiresAt: assignment.expiresAt,
    createdAt: assignment.createdAt,
  }));
}

export async function assignRole({ userId, roleId, branchId = null, expiresAt = null }, actor) {
  const [user, role] = await Promise.all([
    prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true, isSuperAdmin: true } }),
    prisma.role.findUnique({ where: { id: roleId } }),
  ]);

  if (!user) throw ApiError.notFound("User not found");
  if (!role) throw ApiError.notFound("Role not found");
  if (user.isSuperAdmin && !actor.isSuperAdmin) {
    throw ApiError.forbidden("Only a super admin can change a super admin's roles");
  }

  assertCanGrantRole(actor, role);

  // A branch-scoped role without a branch spans every outlet, which is a much
  // bigger grant than it looks — reserve it for super admins.
  if (role.scope === "BRANCH" && !branchId && !actor.isSuperAdmin) {
    throw ApiError.validation("This role must be granted at a specific branch", {
      branchId: ["Required for branch-scoped roles"],
    });
  }

  if (branchId) {
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } });
    if (!branch) throw ApiError.notFound("Branch not found");

    // You can only extend reach into a branch you have reach in yourself.
    if (!actor.isSuperAdmin && !actor.branchIds.includes(null) && !actor.branchIds.includes(branchId)) {
      throw ApiError.forbidden("You do not have access to this branch", { branchId });
    }
  }

  const existing = await prisma.userRoleAssignment.findFirst({
    where: { userId, roleId, branchId },
    select: { id: true },
  });
  if (existing) throw ApiError.conflict("This user already holds that role here");

  await prisma.userRoleAssignment.create({
    data: { userId, roleId, branchId, expiresAt, grantedById: actor.userId },
  });

  invalidatePrincipal(userId);
  return listUserRoles(userId);
}

export async function revokeRole({ userId, assignmentId }, actor) {
  const assignment = await prisma.userRoleAssignment.findFirst({
    where: { id: assignmentId, userId },
    include: { role: true, user: { select: { isSuperAdmin: true } } },
  });
  if (!assignment) throw ApiError.notFound("Role assignment not found");

  if (assignment.user.isSuperAdmin && !actor.isSuperAdmin) {
    throw ApiError.forbidden("Only a super admin can change a super admin's roles");
  }
  assertCanGrantRole(actor, assignment.role);

  await prisma.userRoleAssignment.delete({ where: { id: assignmentId } });
  invalidatePrincipal(userId);

  return listUserRoles(userId);
}

// --- per-user overrides ---------------------------------------------------

export async function listUserOverrides(userId) {
  const overrides = await prisma.userPermissionOverride.findMany({
    where: { userId },
    include: {
      permission: { select: { key: true, label: true, module: true } },
      branch: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return overrides.map((override) => ({
    id: override.id,
    permission: override.permission,
    branch: override.branch,
    effect: override.effect,
    reason: override.reason,
    expiresAt: override.expiresAt,
    createdAt: override.createdAt,
  }));
}

/**
 * A single extra allow or deny on top of the user's roles, so a one-off
 * exception does not require inventing a whole role for one person.
 */
export async function setUserOverride(
  { userId, permissionKey, effect = "ALLOW", branchId = null, reason = null, expiresAt = null },
  actor,
) {
  const [user, permission] = await Promise.all([
    prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true, isSuperAdmin: true } }),
    prisma.permission.findUnique({ where: { key: permissionKey }, select: { id: true } }),
  ]);

  if (!user) throw ApiError.notFound("User not found");
  if (!permission) throw ApiError.validation("Unknown permission", { permissionKey: ["No such permission"] });
  if (user.isSuperAdmin && !actor.isSuperAdmin) {
    throw ApiError.forbidden("Only a super admin can change a super admin's permissions");
  }

  // Denying is always allowed — you can take away what you cannot give.
  if (effect === "ALLOW") assertCanGrantPermissions(actor, [permissionKey], { branchId });

  // Not an upsert: Prisma refuses null inside a compound unique `where`, and a
  // global override is exactly the branchId = null case. Postgres would not
  // enforce that unique index across nulls anyway, so the lookup is explicit.
  const existing = await prisma.userPermissionOverride.findFirst({
    where: { userId, permissionId: permission.id, branchId },
    select: { id: true },
  });

  if (existing) {
    await prisma.userPermissionOverride.update({
      where: { id: existing.id },
      data: { effect, reason, expiresAt, grantedById: actor.userId },
    });
  } else {
    await prisma.userPermissionOverride.create({
      data: { userId, permissionId: permission.id, branchId, effect, reason, expiresAt, grantedById: actor.userId },
    });
  }

  invalidatePrincipal(userId);
  return listUserOverrides(userId);
}

export async function removeUserOverride({ userId, overrideId }, actor) {
  const override = await prisma.userPermissionOverride.findFirst({
    where: { id: overrideId, userId },
    include: { user: { select: { isSuperAdmin: true } } },
  });
  if (!override) throw ApiError.notFound("Permission override not found");
  if (override.user.isSuperAdmin && !actor.isSuperAdmin) {
    throw ApiError.forbidden("Only a super admin can change a super admin's permissions");
  }

  await prisma.userPermissionOverride.delete({ where: { id: overrideId } });
  invalidatePrincipal(userId);

  return listUserOverrides(userId);
}

/**
 * Drops the cached permission set of everyone holding a role that just changed.
 * Without this the change waits out the cache TTL, which is wrong for a
 * revocation.
 */
async function invalidateRoleHolders(roleId) {
  const holders = await prisma.userRoleAssignment.findMany({
    where: { roleId },
    select: { userId: true },
  });
  for (const { userId } of holders) invalidatePrincipal(userId);
}
