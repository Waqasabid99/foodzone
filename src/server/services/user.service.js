import { prisma } from "@/lib/prisma";
import { ApiError, cursorArgs, toPage } from "@/lib/api";
import { invalidatePrincipal } from "@/lib/api/permissions";
import { hashPassword } from "@/server/utils/password";
import { assertCanGrantRole } from "@/server/services/role.service";
import { consumeCredentialCode, issueCredentialCode, revokeCredentialCodes } from "@/server/services/credential-token.service";
import { issueSessionFor, normalizeEmail, publicUser } from "@/server/services/auth.service";
import { sendMailSafely } from "@/server/mail/mailer";
import { accountStatusEmail, staffInviteEmail } from "@/server/mail/templates";
import { env } from "@/lib/env";

/**
 * User administration.
 *
 * Staff never get a password from an administrator. They are created without
 * one, emailed a single-use invitation code, and set their own — so no password
 * ever travels over WhatsApp, and accepting the invite doubles as proof that
 * they control the address.
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
