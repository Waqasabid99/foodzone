import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "@/lib/env";

/**
 * Two different kinds of token, deliberately:
 *
 *   * access  — a short-lived JWT. Stateless, so it is never checked against
 *               the database on the hot path, which is why it must stay short.
 *   * refresh — an opaque random string. It has to be revocable (logout on one
 *               phone, password reset kills all devices), and revocation
 *               requires server state, which a JWT cannot give us.
 *
 * Only the hash of a refresh token is stored, so a database leak does not hand
 * an attacker live sessions.
 */
export const TokenType = { ACCESS: "access" };

export function accessTokenTtlSeconds() {
  return env().ACCESS_TOKEN_TTL_SECONDS;
}

export function refreshTokenTtlSeconds() {
  return env().REFRESH_TOKEN_TTL_SECONDS;
}

/**
 * The payload carries only identity — no roles or permissions.
 *
 * Embedding permissions would make a token that outlives the grant: revoke a
 * role and the user keeps their access until the token expires. They are
 * resolved per request instead, from a short-lived in-process cache.
 *
 * `sid` links the access token to the refresh-token row it was minted from, so
 * revoking one session invalidates its access tokens at the next lookup.
 */
export function signAccessToken({ userId, sessionId }) {
  const { JWT_SECRET, ACCESS_TOKEN_TTL_SECONDS } = env();

  return jwt.sign({ typ: TokenType.ACCESS, ...(sessionId ? { sid: sessionId } : {}) }, JWT_SECRET, {
    subject: userId,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
}

/** Returns null for any invalid, expired or wrong-type token — never throws. */
export function verifyAccessToken(token) {
  const { JWT_SECRET } = env();

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.typ !== TokenType.ACCESS) return null;

    return {
      userId: payload.sub,
      sessionId: payload.sid ?? null,
      // Seconds since epoch. Compared against User.tokensValidFrom so a
      // password reset can invalidate tokens issued before it.
      issuedAt: payload.iat ?? null,
      expiresAt: payload.exp ?? null,
    };
  } catch {
    return null;
  }
}

export function generateRefreshToken() {
  const token = crypto.randomBytes(48).toString("base64url");
  return { token, tokenHash: hashRefreshToken(token) };
}

export function hashRefreshToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function refreshTokenExpiry() {
  return new Date(Date.now() + refreshTokenTtlSeconds() * 1000);
}

// Kept as named constants for callers that just want the default TTLs.
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 15;
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Upload tickets.
 *
 * With direct-to-provider uploads the server is absent while the file moves, so
 * the ticket is what ties the three steps together: it names the exact storage
 * key we signed for, the ceiling we will enforce, and who asked. The confirm
 * step trusts the ticket rather than anything the client says afterwards —
 * otherwise a caller could claim any object in the bucket as their own.
 */
export function signUploadTicket(payload) {
  const { JWT_SECRET, UPLOAD_TICKET_TTL_SECONDS } = env();
  return jwt.sign({ ...payload, typ: "upload" }, JWT_SECRET, { expiresIn: UPLOAD_TICKET_TTL_SECONDS });
}

export function verifyUploadTicket(token) {
  const { JWT_SECRET } = env();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return payload.typ === "upload" ? payload : null;
  } catch {
    return null;
  }
}
