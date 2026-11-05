import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { invalidatePrincipal } from "@/lib/api/permissions";
import { hashPassword, verifyPassword } from "@/server/utils/password";
import { consumeCredentialCode, issueCredentialCode } from "@/server/services/credential-token.service";
import { sendMailSafely } from "@/server/mail/mailer";
import { passwordChangedEmail, passwordResetEmail } from "@/server/mail/templates";
import { issueSessionFor, normalizeEmail } from "@/server/services/auth.service";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Invalidates every credential the account holds: revokes all refresh tokens
 * and moves `tokensValidFrom` forward, which kills access tokens already in
 * flight without waiting out their TTL.
 *
 * Both a reset and a change do this. A password change is either a routine
 * hygiene action or a response to a compromise, and it has to be safe to assume
 * the second.
 */
async function invalidateAllCredentials(tx, userId, reason) {
  await tx.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  await tx.user.update({ where: { id: userId }, data: { tokensValidFrom: new Date() } });
}

/**
 * Starts a reset.
 *
 * Always reports success. Answering "no account with that email" turns this
 * endpoint into a free account-enumeration oracle, which is how credential
 * stuffing lists get refined.
 */
export async function requestPasswordReset({ email }) {
  const normalized = normalizeEmail(email);
  const generic = { sent: true, expiresInMinutes: env().OTP_TTL_MINUTES };

  const user = await prisma.user.findFirst({
    where: { email: normalized, deletedAt: null },
    select: { id: true, name: true, email: true, status: true },
  });

  if (!user || ["SUSPENDED", "DEACTIVATED"].includes(user.status)) return generic;

  try {
    const { code, ttlMinutes } = await issueCredentialCode({
      userId: user.id,
      type: "PASSWORD_RESET",
      destination: user.email,
    });

    await sendMailSafely({ to: user.email, ...passwordResetEmail({ name: user.name, code, ttlMinutes }) });
  } catch (error) {
    // A cooldown rejection must not leak either — swallow it and report the
    // same generic success.
    logger.warn("password reset code not issued", { userId: user.id, error: error.message });
  }

  return generic;
}

/** Completes a reset. No session is returned: the client logs in fresh. */
export async function resetPassword({ email, code, password }) {
  const user = await prisma.user.findFirst({
    where: { email: normalizeEmail(email), deletedAt: null },
    select: { id: true, name: true, email: true, status: true, emailVerifiedAt: true },
  });

  // Same generic failure as a bad code, for the same enumeration reason.
  if (!user) throw ApiError.validation("That code is invalid or has expired");

  await prisma.$transaction(async (tx) => {
    await consumeCredentialCode({ userId: user.id, type: "PASSWORD_RESET", code, client: tx });

    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(password),
        // Receiving the code proves control of the address, so a reset also
        // completes verification for an account still waiting on it.
        ...(user.emailVerifiedAt ? {} : { emailVerifiedAt: new Date() }),
        ...(user.status === "PENDING_VERIFICATION" ? { status: "ACTIVE" } : {}),
        // Whatever an administrator issued, this one is theirs.
        mustChangePassword: false,
      },
    });

    await invalidateAllCredentials(tx, user.id, "PASSWORD_RESET");
  });

  invalidatePrincipal(user.id);

  await sendMailSafely({
    to: user.email,
    ...passwordChangedEmail({ name: user.name, at: new Date().toUTCString() }),
  });

  return { reset: true };
}

/**
 * Changes the password of the signed-in user.
 *
 * Every other device is signed out, and this one is handed a fresh session, so
 * the person who just changed their password is not logged out of the app they
 * did it in.
 */
export async function changePassword({ principal, currentPassword, newPassword, client, ipAddress, userAgent }) {
  const user = await prisma.user.findFirst({ where: { id: principal.userId, deletedAt: null } });
  if (!user) throw ApiError.unauthorized();

  if (!user.passwordHash) {
    throw ApiError.conflict("This account has no password yet — use the reset flow to set one");
  }
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw ApiError.validation("Your current password is incorrect", { currentPassword: ["Incorrect password"] });
  }
  if (await verifyPassword(newPassword, user.passwordHash)) {
    throw ApiError.validation("Choose a password you have not used before", {
      newPassword: ["This is your current password"],
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
    });
    await invalidateAllCredentials(tx, user.id, "PASSWORD_CHANGED");
  });

  invalidatePrincipal(user.id);

  await sendMailSafely({
    to: user.email,
    ...passwordChangedEmail({ name: user.name, at: new Date().toUTCString() }),
  });

  const fresh = await prisma.user.findUnique({ where: { id: user.id } });
  return issueSessionFor({ user: fresh, client, ipAddress, userAgent });
}
