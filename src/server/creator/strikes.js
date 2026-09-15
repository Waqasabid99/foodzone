/**
 * Strike accounting and what it does to a creator's standing.
 *
 * Pure, and separate from the moderation service because the thresholds are a
 * policy that gets argued about and changed, and the argument is much easier
 * when the rule is one testable function rather than an `if` buried in a
 * takedown handler.
 *
 * Strikes carry **points** rather than being counted, so severity can differ:
 * a watermarked clip is not a fake order. Points expire, because a program that
 * never forgives loses the creators who made one mistake a year ago.
 */

/** Default weights. An admin may override per strike. */
export const STRIKE_POINTS = {
  MISLEADING_CONTENT: 2,
  INAPPROPRIATE_CONTENT: 3,
  THIRD_PARTY_CONTENT: 2,
  FAKE_ORDER: 3,
  ATTRIBUTION_ABUSE: 3,
  REPEATED_REJECTIONS: 1,
  OTHER: 1,
};

export function defaultPointsFor(reason) {
  return STRIKE_POINTS[reason] ?? 1;
}

/** Only live strikes count: revoked ones never happened, expired ones lapsed. */
export function activeStrikes(strikes = [], at = new Date()) {
  return strikes.filter((strike) => {
    if (strike.revokedAt) return false;
    if (strike.expiresAt && new Date(strike.expiresAt) <= new Date(at)) return false;
    return true;
  });
}

export function totalPoints(strikes = [], at = new Date()) {
  return activeStrikes(strikes, at).reduce((sum, strike) => sum + Number(strike.points ?? 1), 0);
}

/**
 * What a point total means for the account.
 *
 * Checked ban-first: somebody past the ban threshold is banned, not suspended,
 * however the points accumulated. Returning the *target* status rather than
 * mutating anything keeps the decision inspectable — an admin can be shown
 * "this strike will suspend them" before it is issued.
 */
export function standingFor({ points, suspendAtStrikePoints = 3, banAtStrikePoints = 5 }) {
  if (points >= banAtStrikePoints) {
    return { status: "BANNED", reason: `Reached ${points} strike points` };
  }
  if (points >= suspendAtStrikePoints) {
    return { status: "SUSPENDED", reason: `Reached ${points} strike points` };
  }
  return { status: "ACTIVE", reason: null };
}

/**
 * Whether a video may still be re-uploaded.
 *
 * The attempt limit exists so moderators are not reviewing the same unusable
 * clip for ever. The count that matters is **rejections**, not uploads: a
 * creator whose first four attempts were approved has not used anything up.
 */
export function canReupload({ rejectionCount, maxUploadAttempts = 5, isLocked }) {
  if (isLocked) return false;
  return Number(rejectionCount ?? 0) < Number(maxUploadAttempts);
}

export function attemptsRemaining({ rejectionCount, maxUploadAttempts = 5 }) {
  return Math.max(0, Number(maxUploadAttempts) - Number(rejectionCount ?? 0));
}

/**
 * Whether a creator is suspended right now.
 *
 * A suspension with a date in the past has served its term, so the status is
 * derived rather than trusted — otherwise somebody stays locked out until a job
 * happens to run.
 */
export function isSuspended(creator, at = new Date()) {
  if (creator?.status === "BANNED") return true;
  if (creator?.status !== "SUSPENDED") return false;
  if (!creator.suspendedUntil) return true;
  return new Date(creator.suspendedUntil) > new Date(at);
}

/** The status a creator should hold, once a lapsed suspension is accounted for. */
export function effectiveStatus(creator, at = new Date()) {
  if (creator?.status === "SUSPENDED" && creator.suspendedUntil && new Date(creator.suspendedUntil) <= new Date(at)) {
    return "ACTIVE";
  }
  return creator?.status ?? "PENDING";
}
