import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Works out what a gateway actually signs, from one real delivery.
 *
 * Safepay's documentation and Safepay's own SDK disagree: the docs HMAC
 * `JSON.stringify(payload)`, the SDK HMACs `JSON.stringify(body.data)`, and
 * neither signs the raw bytes. Guessing wrong means either rejecting genuine
 * callbacks or — far worse — writing a verifier that re-serialises the body
 * and therefore accepts a forged one.
 *
 * So rather than pick a reading, this brute-forces the small space of
 * plausible schemes against a captured delivery and reports which one
 * reproduces the signature the gateway sent.
 *
 *   node --env-file=.env scripts/webhook-forensics.mjs <webhookSecret> [file]
 *
 * With no file it uses the most recent capture in storage/webhook-capture.
 *
 * The development-only endpoint that wrote those captures has been removed now
 * that Safepay is settled. Onboarding the next gateway means re-adding a route
 * that writes `{ headers, bodyBase64 }` for each callback and pointing a
 * tunnel at it; this script reads that shape and needs nothing else.
 * The secret is passed as an argument so it never has to be written down in
 * a file that might get committed.
 */

const CAPTURE_DIR = path.join(process.cwd(), "storage", "webhook-capture");

const secret = process.argv[2];
if (!secret) {
  console.error("usage: node --env-file=.env scripts/webhook-forensics.mjs <webhookSecret> [capture.json]");
  process.exit(1);
}

const file =
  process.argv[3] ??
  (() => {
    if (!fs.existsSync(CAPTURE_DIR)) {
      console.error(`Nothing captured yet: ${CAPTURE_DIR} does not exist.`);
      process.exit(1);
    }
    const files = fs
      .readdirSync(CAPTURE_DIR)
      .filter((name) => name.endsWith(".json"))
      .sort();
    if (!files.length) {
      console.error(`Nothing captured yet in ${CAPTURE_DIR}. Send a test webhook first.`);
      process.exit(1);
    }
    return path.join(CAPTURE_DIR, files[files.length - 1]);
  })();

const record = JSON.parse(fs.readFileSync(file, "utf8"));
const raw = Buffer.from(record.bodyBase64, "base64");

console.log(`\nCapture:   ${file}`);
console.log(`Received:  ${record.receivedAt}`);
console.log(`Bytes:     ${record.byteLength}`);

const sfpyHeaders = Object.entries(record.headers).filter(([key]) => key.startsWith("x-sfpy"));
console.log("\nGateway headers:");
for (const [key, value] of sfpyHeaders) console.log(`  ${key}: ${value}`);

const claimed = Object.entries(record.headers)
  .filter(([key]) => key.includes("signature") || key.includes("sign"))
  .map(([, value]) => value);

if (!claimed.length) {
  console.log("\nNo signature header found. Headers present:");
  for (const key of Object.keys(record.headers).sort()) console.log(`  ${key}`);
  process.exit(1);
}

let parsed = null;
try {
  parsed = JSON.parse(raw.toString("utf8"));
} catch {
  console.log("\n(body is not JSON, so only raw-byte candidates apply)");
}

const timestamp = record.headers["x-sfpy-timestamp"] ?? null;

/** The messages a gateway might plausibly be signing. */
const messages = new Map();
messages.set("raw bytes", raw);
if (parsed) {
  messages.set("JSON.stringify(payload)", Buffer.from(JSON.stringify(parsed)));
  if (parsed.data !== undefined) {
    messages.set("JSON.stringify(payload.data)", Buffer.from(JSON.stringify(parsed.data)));
  }
  if (typeof parsed.token === "string") messages.set("payload.token", Buffer.from(parsed.token));
  if (typeof parsed.data === "string") messages.set("payload.data (string)", Buffer.from(parsed.data));
  if (typeof parsed.data?.tracker === "string") {
    messages.set("payload.data.tracker", Buffer.from(parsed.data.tracker));
  }
}
if (timestamp) {
  messages.set("timestamp + '.' + raw", Buffer.concat([Buffer.from(`${timestamp}.`), raw]));
  if (parsed) {
    messages.set("timestamp + '.' + JSON.stringify(payload)", Buffer.from(`${timestamp}.${JSON.stringify(parsed)}`));
  }
}

/** The key might be the literal string, or base64/hex that decodes to bytes. */
const keys = new Map([["secret as text", Buffer.from(secret, "utf8")]]);
const asBase64 = Buffer.from(secret, "base64");
if (asBase64.length && asBase64.toString("base64").replace(/=+$/, "") === secret.replace(/=+$/, "")) {
  keys.set("secret base64-decoded", asBase64);
}
if (/^[0-9a-f]+$/i.test(secret) && secret.length % 2 === 0) {
  keys.set("secret hex-decoded", Buffer.from(secret, "hex"));
}

const algorithms = ["sha512", "sha256", "sha1"];
const encodings = ["hex", "base64", "base64url"];

const matches = [];
let tried = 0;

for (const [keyName, key] of keys) {
  for (const [messageName, message] of messages) {
    for (const algorithm of algorithms) {
      const mac = crypto.createHmac(algorithm, key).update(message).digest();
      for (const encoding of encodings) {
        const digest = mac.toString(encoding);
        for (const candidate of [digest, `${algorithm}=${digest}`, digest.toUpperCase()]) {
          tried += 1;
          if (claimed.some((value) => value === candidate)) {
            matches.push({ keyName, messageName, algorithm, encoding, form: candidate === digest ? "bare" : candidate.startsWith(algorithm) ? "prefixed" : "uppercase" });
          }
        }
      }
    }
  }
}

console.log(`\nTried ${tried} combinations.\n`);

if (!matches.length) {
  console.log("NO MATCH.");
  console.log("\nThe signature is not any of: HMAC-SHA512/256/1 over the raw bytes, the re-serialised");
  console.log("payload, the re-serialised `data` field, or a timestamp-prefixed variant, with the");
  console.log("secret as text/base64/hex and the digest as hex/base64/base64url.");
  console.log("\nMost likely causes, in order:");
  console.log("  1. the secret passed here is not the one that signed this delivery");
  console.log("     (sandbox and live have different keys, and rotating replaces them immediately)");
  console.log("  2. the body was altered in transit — check ngrok is not rewriting anything");
  console.log("  3. the scheme includes a field this script does not know about");
  console.log("\nBody, for inspection:");
  console.log(raw.toString("utf8").slice(0, 1200));
  process.exit(2);
}

console.log("MATCH FOUND:\n");
for (const match of matches) {
  console.log(`  key:       ${match.keyName}`);
  console.log(`  message:   ${match.messageName}`);
  console.log(`  algorithm: HMAC-${match.algorithm.toUpperCase()}`);
  console.log(`  encoding:  ${match.encoding} (${match.form})`);
  console.log("");
}

if (matches.some((match) => match.messageName !== "raw bytes")) {
  console.log("NOTE: the gateway signs a re-serialised body, not the raw bytes.");
  console.log("That means our verifier has to re-serialise too, and a payload whose key order or");
  console.log("number formatting differs from what the gateway produced will fail to verify.");
  console.log("Worth pinning down before this goes near production.");
}
