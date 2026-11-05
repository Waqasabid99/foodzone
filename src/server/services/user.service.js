import { prisma } from "@/lib/prisma";
import { ApiError, cursorArgs, toPage } from "@/lib/api";
import { invalidatePrincipal } from "@/lib/api/permissions";
import { generateTemporaryPassword, hashPassword } from "@/server/utils/password";
import { assertCanGrantRole } from "@/server/services/role.service";
import { consumeCredentialCode, issueCredentialCode, revokeCredentialCodes } from "@/server/services/credential-token.service";
import { issueSessionFor, normalizeEmail, publicUser } from "@/server/services/auth.service";
import { sendMailSafely } from "@/server/mail/mailer";
import { accountStatusEmail, staffInviteEmail, temporaryPasswordEmail } from "@/server/mail/templates";
import { env } from "@/lib/env";

/**
 * User administration.
 *
 * Staff are normally created without a password, emailed a single-use
 * invitation code, and set their own — so no password travels over WhatsApp,
 * and accepting the invite doubles as proof that they control the address.
 *
 * `setTemporaryPassword` is the deliberate exception, for kitchen and counter
 * staff who have no reachable email. It is generated rather than chosen, shown
 * once, kills every session, and leaves the account able to do nothing but
 * choose a real password.
 */

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  avatarUrl: true,
  locale: true,
  status: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
  isSuperAdmin: true,
  lastLoginAt: true,
  passwordHash: true,
  createdAt: true,
  updatedAt: true,
};

function toAdminUser(user) {
  const { passwordHash, ...rest } = user;
  return {
    ...publicUser(rest, { roles: user.roleAssignments ?? [] }),
    // The admin screens say "Branch Manager at Downtown", so the grants carry
    // the branch and the assignment id the revoke button needs.
    roles: (user.roleAssignments ?? []).map((assignment) => ({
      assignmentId: assignment.id,
      key: assignment.role.key,
      name: assignment.role.name,
      scope: assignment.role.scope,
      level: assignment.role.level,
      branchId: assignment.branchId ?? null,
      branch: assignment.branch ?? null,
      expiresAt: assignment.expiresAt ?? null,
    })),
    lastLoginAt: user.lastLoginAt,
    // Distinguishes an invited account that has not been accepted yet from a
    // real one, which is the difference the admin list needs to show.
    hasPassword: Boolean(passwordHash),
    invitePending: !passwordHash && user.status === "PENDING_VERIFICATION",
    updatedAt: user.updatedAt,
  };
}

const ROLE_INCLUDE = {
  roleAssignments: {
    include: {
      role: { select: { id: true, key: true, name: true, scope: true, level: true } },
      branch: { select: { id: true, name: true, code: true } },
    },
  },
};

/** Guards every write that targets another account. */
function assertCanManage(actor, target, { action = "modify" } = {}) {
  if (target.isSuperAdmin && !actor.isSuperAdmin) {
    throw ApiError.forbidden(`Only a super admin can ${action} a super admin`);
  }
}

function assertNotSelf(actor, userId, message) {
  if (actor.userId === userId) throw ApiError.validation(message);
}

export async function listUsers({ search, status, roleKey, branchId, limit = 20, cursor }) {
  const where = {
    deletedAt: null,
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { phone: { contains: search } },
          ],
        }
      : {}),
    ...(roleKey || branchId
      ? {
          roleAssignments: {
            some: { ...(roleKey ? { role: { key: roleKey } } : {}), ...(branchId ? { branchId } : {}) },
          },
        }
      : {}),
  };

  const rows = await prisma.user.findMany({
    where,
    select: { ...USER_SELECT, ...ROLE_INCLUDE },
    orderBy: { createdAt: "desc" },
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);
  return { ...page, items: page.items.map(toAdminUser) };
}

export async function getUser(userId) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { ...USER_SELECT, ...ROLE_INCLUDE },
  });
  if (!user) throw ApiError.notFound("User not found");
  return toAdminUser(user);
}

/** Validates a set of role grants before any of them is written. */
async function resolveGrants(roleIds = [], branchId, actor) {
  if (!roleIds.length) return [];

  const roles = await prisma.role.findMany({ where: { id: { in: roleIds } } });
  if (roles.length !== roleIds.length) throw ApiError.validation("One or more roles do not exist");

  for (const role of roles) {
    assertCanGrantRole(actor, role);
    if (role.scope === "BRANCH" && !branchId && !actor.isSuperAdmin) {
      throw ApiError.validation("Branch-scoped roles must name a branch", {
        branchId: ["Required for branch-scoped roles"],
      });
    }
  }

  if (branchId) {
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } });
    if (!branch) throw ApiError.notFound("Branch not found");
    if (!actor.isSuperAdmin && !actor.branchIds.includes(null) && !actor.branchIds.includes(branchId)) {
      throw ApiError.forbidden("You do not have access to this branch", { branchId });
    }
  }

  return roles.map((role) => ({
    roleId: role.id,
    // A global role ignores the branch even when one was supplied.
    branchId: role.scope === "BRANCH" ? (branchId ?? null) : null,
    grantedById: actor.userId,
  }));
}

/** Creates a staff account and emails the invitation. */
export async function createUser({ name, email, phone, roleIds = [], branchId = null }, actor) {
  const normalizedEmail = normalizeEmail(email);

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } });
  if (existing) throw ApiError.conflict("That email is already registered");

  const grants = await resolveGrants(roleIds, branchId, actor);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        phone: phone || null,
        status: "PENDING_VERIFICATION",
        // No password: the invitation is how one gets set.
        passwordHash: null,
      },
    });

    if (grants.length) {
      await tx.userRoleAssignment.createMany({
        data: grants.map((grant) => ({ ...grant, userId: created.id })),
      });
    }

    return created;
  });

  await sendInvitation({ user, actor });
  return getUser(user.id);
}

/** Issues an invitation code and emails it. */
async function sendInvitation({ user, actor }) {
  const ttlHours = env().INVITE_TTL_HOURS;

  const { code } = await issueCredentialCode({
    userId: user.id,
    type: "STAFF_INVITE",
    destination: user.email,
    ttlMinutes: ttlHours * 60,
  });

  const assignments = await prisma.userRoleAssignment.findMany({
    where: { userId: user.id },
    select: { role: { select: { name: true } } },
  });

  await sendMailSafely({
    to: user.email,
    ...staffInviteEmail({
      name: user.name,
      email: user.email,
      code,
      inviterName: actor?.name,
      roleNames: assignments.map((assignment) => assignment.role.name),
      ttlHours,
    }),
  });

  return { sent: true, expiresInHours: ttlHours };
}

export async function resendInvitation({ userId }, actor) {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user) throw ApiError.notFound("User not found");
  assertCanManage(actor, user, { action: "invite" });

  if (user.passwordHash) throw ApiError.conflict("This user has already set a password");

  return sendInvitation({ user, actor });
}

/**
 * Accepts an invitation: sets the password, verifies the email (receiving the
 * code proves control of it) and activates the account.
 */
export async function acceptInvitation({ email, code, password, client, ipAddress, userAgent }) {
  const user = await prisma.user.findFirst({
    where: { email: normalizeEmail(email), deletedAt: null },
  });

  // Same generic error as a bad code: this endpoint is unauthenticated.
  const invalid = ApiError.validation("That invitation is invalid or has expired");
  if (!user) throw invalid;
  if (user.passwordHash) throw ApiError.conflict("This invitation has already been accepted");

  await prisma.$transaction(async (tx) => {
    await consumeCredentialCode({ userId: user.id, type: "STAFF_INVITE", code, client: tx });

    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(password),
        emailVerifiedAt: new Date(),
        status: "ACTIVE",
        // They have just chosen it themselves.
        mustChangePassword: false,
      },
    });
  });

  invalidatePrincipal(user.id);

  const fresh = await prisma.user.findUnique({ where: { id: user.id } });
  return issueSessionFor({ user: fresh, client, ipAddress, userAgent });
}

export async function updateUser(userId, { name, phone, locale, avatarUrl }, actor) {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user) throw ApiError.notFound("User not found");
  assertCanManage(actor, user, { action: "edit" });

  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      // Changing the phone clears its verification: the new number is unproven.
      ...(phone !== undefined ? { phone: phone || null, phoneVerifiedAt: null } : {}),
      ...(locale !== undefined ? { locale } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
    },
  });

  return getUser(userId);
}

/**
 * Suspends or reactivates an account.
 *
 * Suspension revokes every session immediately — an account you have disabled
 * must not keep working for the life of its access token.
 */
export async function setUserStatus(userId, { status, reason }, actor) {
  assertNotSelf(actor, userId, "You cannot change your own account status");

  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user) throw ApiError.notFound("User not found");
  assertCanManage(actor, user, { action: "suspend" });

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        status,
        ...(status === "SUSPENDED" ? { tokensValidFrom: new Date() } : {}),
      },
    });

    if (status !== "ACTIVE") {
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: `STATUS_${status}` },
      });
    }
  });

  if (status !== "ACTIVE") await revokeCredentialCodes({ userId });
  invalidatePrincipal(userId);

  if (user.email && ["SUSPENDED", "ACTIVE"].includes(status)) {
    await sendMailSafely({
      to: user.email,
      ...accountStatusEmail({ name: user.name, status, reason }),
    });
  }

  return getUser(userId);
}

/**
 * Issues a temporary password an administrator reads out to someone locked
 * out — the fallback for staff with no reachable email.
 *
 * Three things make it survivable: the system generates it (nobody types in a
 * password they also use elsewhere), every session is revoked so the account
 * is briefly reachable by nobody, and `mustChangePassword` holds the account
 * to changing it before it can do anything else. It is returned exactly once,
 * in this response, and never stored in readable form.
 */
export async function setTemporaryPassword(userId, actor) {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user) throw ApiError.notFound("User not found");
  assertCanManage(actor, user, { action: "set a password for" });
  if (user.status === "SUSPENDED" || user.status === "DEACTIVATED") {
    throw ApiError.conflict("Reactivate this account before giving it a password");
  }

  const password = generateTemporaryPassword();
  const passwordHash = await hashPassword(password);
  const at = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        mustChangePassword: true,
        tokensValidFrom: at,
        // An invited account that never accepted is now usable, so it counts
        // as active; the address stays unverified until they prove it.
        ...(user.status === "PENDING_VERIFICATION" && user.emailVerifiedAt ? { status: "ACTIVE" } : {}),
      },
    });
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: at, revokedReason: "TEMPORARY_PASSWORD_ISSUED" },
    });
  });

  // Outstanding invitation and reset codes are dead: the password they would
  // have set is no longer the current one.
  await revokeCredentialCodes({ userId });
  invalidatePrincipal(userId);

  if (user.email) {
    await sendMailSafely({
      to: user.email,
      ...temporaryPasswordEmail({ name: user.name, at: at.toUTCString(), byName: actor?.name }),
    });
  }

  // The only time this value exists in readable form.
  return { password, mustChangePassword: true, user: await getUser(userId) };
}

/** Where an account is signed in. The token itself is never shown, only its trail. */
export async function listSessions(userId) {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true } });
  if (!user) throw ApiError.notFound("User not found");

  return prisma.refreshToken.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, client: true, ipAddress: true, userAgent: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    orderBy: [{ lastUsedAt: "desc" }, { createdAt: "desc" }],
    take: 50,
  });
}

/**
 * Signs an account out everywhere, or off one device.
 *
 * Revoking the refresh token alone would leave the current access token
 * working until it expires, so a full revoke also moves `tokensValidFrom` —
 * which is what "sign them out now" has to mean.
 */
export async function revokeSessions(userId, { sessionId = null, actor }) {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user) throw ApiError.notFound("User not found");
  assertCanManage(actor, user, { action: "sign out" });

  const at = new Date();
  const result = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null, ...(sessionId ? { id: sessionId } : {}) },
    data: { revokedAt: at, revokedReason: sessionId ? "REVOKED_BY_ADMIN" : "ALL_REVOKED_BY_ADMIN" },
  });

  if (!sessionId) {
    await prisma.user.update({ where: { id: userId }, data: { tokensValidFrom: at } });
    invalidatePrincipal(userId);
  }

  return { revoked: result.count };
}

/**
 * Soft delete. The row stays because orders, audit entries and payslips point
 * at it; hard-deleting a user would either orphan or cascade away real history.
 */
export async function deleteUser(userId, actor) {
  assertNotSelf(actor, userId, "You cannot delete your own account");

  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user) throw ApiError.notFound("User not found");
  assertCanManage(actor, user, { action: "delete" });
  if (user.isSuperAdmin) throw ApiError.forbidden("A super admin cannot be deleted");

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { deletedAt: new Date(), status: "DEACTIVATED", tokensValidFrom: new Date() },
    });
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "USER_DELETED" },
    });
  });

  await revokeCredentialCodes({ userId });
  invalidatePrincipal(userId);

  return { deleted: true };
}
