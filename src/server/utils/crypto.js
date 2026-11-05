import crypto from "node:crypto";

/**
 * Secrets the system hands out: password-reset links, OTPs, QR tokens,
 * share links.
 *
 * Anything a user can present back to us is stored hashed, never in plaintext,
 * so a database leak does not hand over live credentials. The only exceptions
 * are values that are public by design (a QR code's short code).
 */
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Issues a token and its hash together: send the first, store the second. */
export function issueToken(bytes = 32) {
  const token = randomToken(bytes);
  return { token, tokenHash: hashToken(token) };
}

/**
 * Numeric OTP. `crypto.randomInt` is uniform — `Math.random()` is neither
 * uniform enough nor unpredictable, and an OTP is a credential.
 */
export function randomNumericCode(digits = 6) {
  const max = 10 ** digits;
  return String(crypto.randomInt(0, max)).padStart(digits, "0");
}

// Crockford-style alphabet: no I, L, O, U, so a code read off a printed QR
// sticker or a receipt cannot be mistyped into a different valid code.
const SHORT_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Short public identifier for QR codes, share links and claim codes. */
export function shortCode(length = 8) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += SHORT_CODE_ALPHABET[bytes[i] % SHORT_CODE_ALPHABET.length];
  return out;
}

/**
 * Constant-time comparison. A plain `===` leaks how much of a secret matched
 * through timing, which is enough to recover it one character at a time.
 */
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** Verifies a presented secret against its stored hash, in constant time. */
export function verifyToken(token, storedHash) {
  return safeEqual(hashToken(token), storedHash);
}

/** HMAC for webhook signature verification (payment gateways). */
export function hmacSha256(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifySignature(payload, signature, secret) {
  return safeEqual(hmacSha256(payload, secret), signature);
}
