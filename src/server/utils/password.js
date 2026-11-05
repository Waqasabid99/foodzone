import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";

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

/**
 * A temporary password an administrator can read out loud.
 *
 * Words and digits rather than symbols, because this one is dictated over a
 * counter or a phone; length carries the strength instead. Built from
 * `randomInt`, which is the cryptographic generator — `Math.random` is
 * predictable and this is a credential. It is single-use in practice: issuing
 * one forces the holder to choose their own before the account can do
 * anything else.
 */
const TEMP_WORDS = [
  "amber", "basil", "cedar", "delta", "ember", "fennel", "ginger", "harbor", "indigo", "juniper",
  "kettle", "lantern", "meadow", "nutmeg", "olive", "pepper", "quartz", "rosemary", "saffron", "thyme",
  "umber", "violet", "walnut", "yarrow", "zephyr",
];

export function generateTemporaryPassword() {
  const word = () => TEMP_WORDS[randomInt(TEMP_WORDS.length)];
  const digits = String(randomInt(1000, 10000));
  // e.g. "cedar-meadow-saffron-4821" — 25 words cubed x 9000 is far short of a
  // long random string, which is why it expires on first use rather than
  // standing as a password.
  return `${word()}-${word()}-${word()}-${digits}`;
}
