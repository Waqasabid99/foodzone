import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/api";
import { hashToken, randomNumericCode, safeEqual } from "@/server/utils/crypto";

/**
 * One-time codes: email verification, password reset, staff invitations.
 *
 * Three properties matter and each is enforced here rather than at the call
 * sites, so no flow can accidentally skip one:
 *
 *   * stored hashed — a database leak must not hand over live codes
 *   * single-use and short-lived — issuing a new code retires the previous one
 *   * attempt-capped — six digits is only 1e6 possibilities, so without a cap
 *     a script guesses it in minutes
 *
 * A resend cooldown lives in the database rather than in memory, because an
 * in-memory cooldown resets on deploy and does not hold across instances.
 */

/** Issues a code, retiring any previous one of the same type for that user. */
export async function issueCredentialCode({
  userId,
  type,
  destination,
  channel = "EMAIL",
  ttlMinutes,
  cooldownSeconds,
  client = prisma,
}) {
  const config = env();
  const ttl = ttlMinutes ?? config.OTP_TTL_MINUTES;
  const cooldown = cooldownSeconds ?? config.OTP_RESEND_COOLDOWN_SECONDS;

  if (cooldown > 0) {
    const latest = await client.credentialToken.findFirst({
      where: { userId, type },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    if (latest) {
      const elapsed = (Date.now() - latest.createdAt.getTime()) / 1000;
      if (elapsed < cooldown) {
        throw ApiError.rateLimited("Please wait before requesting another code", {
          retryAfterSeconds: Math.ceil(cooldown - elapsed),
        });
      }
    }
  }

  // Retire outstanding codes so only the newest one works. Without this, an
  // attacker who saw an old code keeps a second valid guess.
  await client.credentialToken.updateMany({
    where: { userId, type, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const code = randomNumericCode(config.OTP_LENGTH);

  await client.credentialToken.create({
    data: {
      userId,
      type,
      channel,
      destination,
      tokenHash: hashToken(code),
      expiresAt: new Date(Date.now() + ttl * 60_000),
    },
  });

  return { code, ttlMinutes: ttl };
}

/**
 * Verifies and consumes a code.
 *
 * Every failure returns the same message: telling a caller whether the code was
 * wrong, expired or never issued hands them a way to enumerate accounts.
 */
export async function consumeCredentialCode({ userId, type, code, client = prisma }) {
  const invalid = ApiError.validation("That code is invalid or has expired");
  if (!code) throw invalid;

  const token = await client.credentialToken.findFirst({
    where: { userId, type, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  if (!token) throw invalid;

  if (token.attempts >= env().OTP_MAX_ATTEMPTS) {
    // Burn it: a code under brute force is no longer trustworthy even if the
    // next guess happens to be right.
    await client.credentialToken.update({
      where: { id: token.id },
      data: { consumedAt: new Date() },
    });
    throw ApiError.rateLimited("Too many incorrect attempts. Request a new code.");
  }

  if (!safeEqual(hashToken(String(code)), token.tokenHash)) {
    await client.credentialToken.update({
      where: { id: token.id },
      data: { attempts: { increment: 1 } },
    });
    throw invalid;
  }

  await client.credentialToken.update({
    where: { id: token.id },
    data: { consumedAt: new Date() },
  });

  return token;
}

/** Clears outstanding codes — used when an account is suspended or deleted. */
export async function revokeCredentialCodes({ userId, type, client = prisma }) {
  await client.credentialToken.updateMany({
    where: { userId, ...(type ? { type } : {}), consumedAt: null },
    data: { consumedAt: new Date() },
  });
}
