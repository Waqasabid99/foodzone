import crypto from "node:crypto";

/**
 * Reversible encryption for credentials we have to be able to read back.
 *
 * `crypto.js` hashes: a password, an OTP, a QR token — none of them ever need
 * to be recovered, so none of them are. Payment gateway credentials break that
 * rule by nature. We must hand the real API secret, Integrity Salt or webhook
 * key to the gateway on every call, so it has to come back out of the database
 * intact. Hashing is not an option, and storing plaintext is not either.
 *
 * So this is deliberately the *only* place in the system where a secret can be
 * recovered from a stored value, and it is kept apart from the hashing helpers
 * so that nobody reaches for the wrong one by autocomplete. If you are storing
 * something a user presents back to us, you want `hashToken`, not this.
 *
 * Three properties matter, and each is tested:
 *
 *   * **Authenticated.** AES-256-GCM, so a tampered ciphertext fails loudly
 *     instead of decrypting to garbage that then gets sent to a gateway as if
 *     it were a key.
 *   * **Bound to its place.** The branch, provider and field name are passed as
 *     additional authenticated data, so an envelope lifted out of one row
 *     cannot be pasted into another. Without this, anyone who can write to the
 *     table could point branch B's credentials at branch A's gateway account
 *     and collect their takings.
 *   * **Rotatable.** The envelope names the key that sealed it. The newest key
 *     encrypts; every configured key can decrypt. That means a rotation is
 *     "prepend the new key and re-save rows over time", not "rewrite every row
 *     in one transaction or lose them all".
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
// GCM's standard nonce length. Longer is not better here: 96 bits is what the
// mode is specified for, and anything else makes interop and review harder.
const IV_BYTES = 12;
const KEY_BYTES = 32;
const KEY_ID = /^[a-z0-9_-]{1,32}$/;

/**
 * `CREDENTIAL_ENCRYPTION_KEYS` is `keyId:base64key[,keyId:base64key...]`, newest
 * first. Generate one with `openssl rand -base64 32`.
 *
 * Parsed per call rather than at import, and cached against the raw string, so
 * a key added at deploy time is picked up without a restart and a test can swap
 * keys without fighting a frozen module.
 */
let cache = { raw: null, keys: null };

function keyring() {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEYS ?? "";
  if (!raw.trim()) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEYS is not set, so gateway credentials cannot be stored. " +
        "Set it to `keyId:base64key` — generate the key with `openssl rand -base64 32`.",
    );
  }

  if (cache.raw === raw) return cache.keys;

  const keys = new Map();
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    // Split on the first colon only: base64 never contains one, but being
    // explicit stops a stray colon from silently truncating a key.
    const separator = trimmed.indexOf(":");
    if (separator <= 0) {
      throw new Error("CREDENTIAL_ENCRYPTION_KEYS entries must be `keyId:base64key`");
    }

    const keyId = trimmed.slice(0, separator);
    if (!KEY_ID.test(keyId)) {
      throw new Error(`CREDENTIAL_ENCRYPTION_KEYS has an invalid key id — expected ${KEY_ID} characters only`);
    }
    if (keys.has(keyId)) {
      throw new Error(`CREDENTIAL_ENCRYPTION_KEYS lists the key id "${keyId}" twice`);
    }

    const key = Buffer.from(trimmed.slice(separator + 1), "base64");
    if (key.length !== KEY_BYTES) {
      // Node would otherwise throw something obscure from deep inside the
      // cipher. A wrong-length key is a configuration mistake, so say that.
      throw new Error(
        `CREDENTIAL_ENCRYPTION_KEYS key "${keyId}" must be exactly ${KEY_BYTES} bytes once base64-decoded ` +
          `(got ${key.length}) — generate one with \`openssl rand -base64 32\``,
      );
    }

    keys.set(keyId, key);
  }

  if (!keys.size) throw new Error("CREDENTIAL_ENCRYPTION_KEYS is set but lists no usable keys");

  cache = { raw, keys };
  return keys;
}

/** The key id new envelopes are sealed with: the first one configured. */
export function activeKeyId() {
  return keyring().keys().next().value;
}

/**
 * Splits an envelope without decrypting it.
 *
 * Exported because two callers legitimately need the key id alone: a rotation
 * job deciding which rows are stale, and the admin screen showing when a
 * credential was last re-sealed. Neither needs the plaintext.
 */
export function parseEnvelope(envelope) {
  if (typeof envelope !== "string" || !envelope) {
    throw new Error("Not a credential envelope: expected a non-empty string");
  }

  const parts = envelope.split(".");
  if (parts.length !== 5) {
    throw new Error(`Not a credential envelope: expected 5 dot-separated parts, got ${parts.length}`);
  }

  const [version, keyId, iv, ciphertext, tag] = parts;
  if (version !== VERSION) {
    throw new Error(`Unsupported credential envelope version "${version}"`);
  }
  if (!KEY_ID.test(keyId)) {
    throw new Error("Credential envelope names no usable key id");
  }
  if (!iv || !ciphertext || !tag) {
    throw new Error("Credential envelope is missing one of its parts");
  }

  return { version, keyId, iv, ciphertext, tag };
}

function requireAad(aad) {
  if (typeof aad !== "string" || !aad) {
    // Not optional by design. A default of "" would mean the first caller who
    // forgot it got an envelope that is valid everywhere, which is exactly the
    // property this is here to prevent.
    throw new Error("An aad is required: pass `${branchId}:${provider}:${field}` so the envelope is bound to its row");
  }
  return Buffer.from(aad, "utf8");
}

/**
 * Seals a credential.
 *
 * `aad` binds the result to where it is stored and must be reproduced exactly
 * to open it. Use `${branchId}:${provider}:${field}`.
 */
export function encryptSecret(plaintext, { aad } = {}) {
  if (typeof plaintext !== "string") throw new Error("Only a string can be sealed");
  const additional = requireAad(aad);

  const keys = keyring();
  const keyId = keys.keys().next().value;
  const key = keys.get(keyId);

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
  cipher.setAAD(additional);

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    keyId,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

/**
 * Opens a credential, or throws.
 *
 * It never reports *why* beyond "could not be decrypted", and never includes
 * the plaintext or the envelope in the message — error strings end up in logs
 * and crash reporters, and a credential that leaks through a log line is still
 * leaked. The one exception is a missing key id, which is named because that is
 * an operational fact about configuration rather than anything about the
 * secret, and without it a botched rotation is almost impossible to diagnose.
 */
export function decryptSecret(envelope, { aad } = {}) {
  const { keyId, iv, ciphertext, tag } = parseEnvelope(envelope);
  const additional = requireAad(aad);

  const keys = keyring();
  const key = keys.get(keyId);
  if (!key) {
    throw new Error(
      `This credential was sealed with key "${keyId}", which is not in CREDENTIAL_ENCRYPTION_KEYS. ` +
        "Restore that key to read it, or have the credential entered again.",
    );
  }

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64url"), { authTagLength: 16 });
    decipher.setAAD(additional);
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    // Deliberately swallows the cause. A GCM failure means the ciphertext, the
    // tag or the aad does not match, and telling a caller which it was is a
    // hint worth withholding.
    throw new Error("This credential could not be decrypted — it was altered, or it belongs to a different record");
  }
}
