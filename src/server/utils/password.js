import bcrypt from "bcryptjs";

/**
 * Cost 12: roughly 250ms on modern server hardware. High enough to make
 * offline cracking expensive, low enough that a login is not a DoS vector.
 */
const COST = 12;

export function hashPassword(password) {
  return bcrypt.hash(password, COST);
}

export function verifyPassword(password, hash) {
  // A missing hash means an account with no password set (OTP-only, or a staff
  // invite not yet accepted). Still run a comparison so the response time does
  // not reveal which case it was.
  if (!hash) return bcrypt.compare(password, "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin");
  return bcrypt.compare(password, hash);
}

/** True when the stored hash was made with an older cost and should be upgraded. */
export function needsRehash(hash) {
  if (!hash) return false;
  const rounds = Number(hash.split("$")[2]);
  return Number.isFinite(rounds) && rounds < COST;
}
