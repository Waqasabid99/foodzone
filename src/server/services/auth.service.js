import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
  accessTokenTtlSeconds,
} from "@/lib/api/tokens";
import { grantedPermissionKeys, invalidatePrincipal, loadPrincipal } from "@/lib/api/permissions";
import { hashPassword, needsRehash, verifyPassword } from "@/server/utils/password";
import { consumeCredentialCode, issueCredentialCode } from "@/server/services/credential-token.service";
import { sendMailSafely } from "@/server/mail/mailer";
import { verificationEmail } from "@/server/mail/templates";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";

export const CUSTOMER_ROLE_KEY = "customer";

/** The user shape clients receive. Never includes the password hash. */
export function publicUser(user, { roles = [], permissions } = {}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    locale: user.locale,
    /** Which workspace page they open on; null means "decide from my job". */
    homePage: user.homePage ?? null,
    status: user.status,
    emailVerified: Boolean(user.emailVerifiedAt),
    phoneVerified: Boolean(user.phoneVerifiedAt),
    isSuperAdmin: user.isSuperAdmin,
    roles: roles.map((role) => ({
      key: role.key ?? role.role?.key,
      name: role.name ?? role.role?.name,
      branchId: role.branchId ?? null,
    })),
    ...(permissions ? { permissions } : {}),
    createdAt: user.createdAt,
  };
}

/**
 * Creates a device session: one RefreshToken row plus a matching access token.
 *
 * The access token carries the session id, so revoking the row invalidates the
 * access token at its next permission lookup rather than waiting out its TTL.
 */
async function issueSession({ user, client = "WEB", ipAddress, userAgent, db = prisma }) {
  const { token, tokenHash } = generateRefreshToken();

  const session = await db.refreshToken.create({
    data: {
      tokenHash,
      userId: user.id,
      client,
      ipAddress,
      userAgent,
      expiresAt: refreshTokenExpiry(),
    },
    select: { id: true },
  });

  return {
    sessionId: session.id,
    accessToken: signAccessToken({ userId: user.id, sessionId: session.id }),
    refreshToken: token,
    expiresIn: accessTokenTtlSeconds(),
    tokenType: "Bearer",
  };
}

/** Assembles the response body for every endpoint that returns a session. */
async function sessionResponse({ user, session }) {
  const principal = await loadPrincipal({ userId: user.id, sessionId: session.sessionId });

  return {
    user: publicUser(user, {
      roles: principal?.roles ?? [],
      permissions: principal ? grantedPermissionKeys(principal) : [],
    }),
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresIn: session.expiresIn,
    tokenType: session.tokenType,
  };
}

export function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

export async function register({ name, email, password, client, ipAddress, userAgent }) {
  const normalizedEmail = normalizeEmail(email);

  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, deletedAt: true },
  });
  if (existing) throw ApiError.conflict("That email is already registered");

  const customerRole = await prisma.role.findUnique({
    where: { key: CUSTOMER_ROLE_KEY },
    select: { id: true },
  });
  if (!customerRole) {
    // The RBAC seed has not run: fail loudly rather than creating a user with
    // no role, who would then be silently unable to do anything.
    throw ApiError.internal("Roles are not configured");
  }

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        passwordHash: await hashPassword(password),
        status: "PENDING_VERIFICATION",
      },
    });

    await tx.userRoleAssignment.create({
      data: { userId: created.id, roleId: customerRole.id },
    });

    return created;
  });

  await sendVerificationCode({ user }).catch((error) =>
    // A mail outage must not fail a registration — the code can be requested
    // again from the client.
    logger.error("verification email failed at registration", { userId: user.id, error: error.message }),
  );

  const session = await issueSession({ user, client, ipAddress, userAgent });
  return { ...(await sessionResponse({ user, session })), emailVerificationRequired: true };
}

export async function login({ email, password, client, ipAddress, userAgent }) {
  const user = await prisma.user.findFirst({
    where: { email: normalizeEmail(email), deletedAt: null },
  });

  // One error for unknown email, wrong password and password-less accounts:
  // distinguishing them tells an attacker which addresses have accounts.
  const invalid = ApiError.unauthorized("Incorrect email or password");
  if (!user) {
    // Still spend the time a real comparison costs, so response timing does not
    // reveal whether the address exists.
    await verifyPassword(password, null);
    throw invalid;
  }
  if (!(await verifyPassword(password, user.passwordHash))) throw invalid;

  if (user.status === "SUSPENDED") {
    throw ApiError.forbidden("This account has been suspended", { reason: "ACCOUNT_SUSPENDED" });
  }
  if (user.status === "DEACTIVATED") {
    throw ApiError.forbidden("This account is no longer active", { reason: "ACCOUNT_DEACTIVATED" });
  }

  // Transparently upgrade hashes made with an older cost factor.
  if (needsRehash(user.passwordHash)) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password) },
    });
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const session = await issueSession({ user, client, ipAddress, userAgent });
  return sessionResponse({ user, session });
}

/**
 * Rotates a refresh token.
 *
 * Rotation plus reuse detection is what makes a stolen refresh token
 * survivable: the thief and the real client cannot both use the same token, and
 * whichever presents it second reveals the theft. On reuse we revoke the whole
 * family — the safe assumption is that we cannot tell which party is the
 * attacker.
 */
export async function refreshSession({ refreshToken, client, ipAddress, userAgent }) {
  if (!refreshToken) throw ApiError.unauthorized("Refresh token is required");

  const expired = ApiError.unauthorized("Session expired, please log in again");
  const tokenHash = hashRefreshToken(refreshToken);

  const result = await prisma.$transaction(async (tx) => {
    const stored = await tx.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) return { error: expired };

    if (stored.revokedAt) {
      // Replay of an already-rotated token: treat the whole chain as burned.
      await tx.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: "TOKEN_REUSE_DETECTED" },
      });
      return { error: expired, reuse: true, userId: stored.userId };
    }

    if (stored.expiresAt < new Date()) return { error: expired };
    if (stored.user.deletedAt || !["ACTIVE", "PENDING_VERIFICATION"].includes(stored.user.status)) {
      return { error: expired };
    }

    const session = await issueSession({
      user: stored.user,
      client: client ?? stored.client,
      ipAddress,
      userAgent,
      db: tx,
    });

    await tx.refreshToken.update({
      where: { id: stored.id },
      data: {
        revokedAt: new Date(),
        revokedReason: "ROTATED",
        replacedById: session.sessionId,
        lastUsedAt: new Date(),
      },
    });

    return { user: stored.user, session };
  });

  if (result.error) {
    if (result.reuse) {
      logger.warn("refresh token reuse detected — all sessions revoked", { userId: result.userId });
      invalidatePrincipal(result.userId);
    }
    throw result.error;
  }

  return sessionResponse({ user: result.user, session: result.session });
}

export async function logout({ refreshToken, userId, allDevices = false }) {
  if (allDevices) {
    if (!userId) throw ApiError.unauthorized();
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "LOGOUT_ALL" },
    });
    invalidatePrincipal(userId);
    return { revoked: "all" };
  }

  if (!refreshToken) return { revoked: "none" };

  const { count } = await prisma.refreshToken.updateMany({
    where: { tokenHash: hashRefreshToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: "LOGOUT" },
  });

  if (userId) invalidatePrincipal(userId);
  return { revoked: count ? "one" : "none" };
}

/** The "where am I signed in" screen. */
export async function listSessions({ userId, currentSessionId }) {
  const sessions = await prisma.refreshToken.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      client: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
    },
  });

  return sessions.map((session) => ({ ...session, current: session.id === currentSessionId }));
}

export async function revokeSession({ userId, sessionId }) {
  const { count } = await prisma.refreshToken.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: "REVOKED_BY_USER" },
  });
  if (!count) throw ApiError.notFound("Session not found");

  invalidatePrincipal(userId);
  return { revoked: true };
}

export async function getCurrentUser({ principal }) {
  const user = await prisma.user.findFirst({
    where: { id: principal.userId, deletedAt: null },
  });
  if (!user) throw ApiError.unauthorized();

  return publicUser(user, {
    roles: principal.roles,
    permissions: grantedPermissionKeys(principal),
  });
}

/** Issues and emails an email-verification code. */
export async function sendVerificationCode({ user }) {
  if (user.emailVerifiedAt) throw ApiError.conflict("This email is already verified");
  if (!user.email) throw ApiError.validation("This account has no email address");

  const { code, ttlMinutes } = await issueCredentialCode({
    userId: user.id,
    type: "EMAIL_VERIFICATION",
    destination: user.email,
  });

  await sendMailSafely({
    to: user.email,
    ...verificationEmail({ name: user.name, code, ttlMinutes }),
  });

  return { sent: true, expiresInMinutes: ttlMinutes, cooldownSeconds: env().OTP_RESEND_COOLDOWN_SECONDS };
}

/**
 * Confirms an email-verification code.
 *
 * Verification is what flips PENDING_VERIFICATION to ACTIVE. Until then the
 * account holds a valid session and can browse, but `requireVerifiedEmail`
 * blocks the actions that need a reachable address — checkout above all.
 */
export async function verifyEmail({ userId, code }) {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user) throw ApiError.unauthorized();
  if (user.emailVerifiedAt) return { verified: true, alreadyVerified: true };

  await consumeCredentialCode({ userId: user.id, type: "EMAIL_VERIFICATION", code });

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerifiedAt: new Date(),
      // Only lift the status if verification was the thing holding it back.
      ...(user.status === "PENDING_VERIFICATION" ? { status: "ACTIVE" } : {}),
    },
  });

  invalidatePrincipal(user.id);
  return { verified: true, status: updated.status };
}

/** Exposed so the password and invitation flows can issue a session too. */
export async function issueSessionFor({ user, client, ipAddress, userAgent, db }) {
  const session = await issueSession({ user, client, ipAddress, userAgent, db });
  return sessionResponse({ user, session });
}
