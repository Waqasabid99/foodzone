import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

/**
 * What the verification page needs to describe itself accurately.
 *
 * Every number here is read from configuration or from the row the server
 * actually wrote, never guessed at the component. Three of them would
 * otherwise be quiet lies on screen:
 *
 *   - how many boxes to draw (`OTP_LENGTH`, configurable 4-10)
 *   - how long the code lasts (`OTP_TTL_MINUTES`)
 *   - how long until "resend" works (`OTP_RESEND_COOLDOWN_SECONDS`, counted
 *     from when the last code was actually issued)
 *
 * The cooldown in particular has to come from the database. The page is loaded
 * some unknown time after registration sent the first code, so a timer started
 * at zero on mount would either block a resend that is already allowed or offer
 * one the server is about to refuse.
 */
export async function verificationState(userId) {
  const config = env();

  const latest = await prisma.credentialToken.findFirst({
    where: { userId, type: "EMAIL_VERIFICATION" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, expiresAt: true, consumedAt: true },
  });

  const cooldownSeconds = config.OTP_RESEND_COOLDOWN_SECONDS;
  let resendAvailableInSeconds = 0;

  if (latest && cooldownSeconds > 0) {
    const elapsed = (Date.now() - latest.createdAt.getTime()) / 1000;
    resendAvailableInSeconds = Math.max(0, Math.ceil(cooldownSeconds - elapsed));
  }

  return {
    codeLength: config.OTP_LENGTH,
    ttlMinutes: config.OTP_TTL_MINUTES,
    cooldownSeconds,
    resendAvailableInSeconds,
    // Whether a code is currently outstanding at all. A page reached long after
    // the code expired should say "request a new one", not count down to a
    // resend of something that is already dead.
    hasLiveCode: Boolean(latest && !latest.consumedAt && latest.expiresAt.getTime() > Date.now()),
  };
}
