import { z } from "zod";
import { ApiError } from "@/lib/api";
import { getProvider } from "@/server/payments/providers";
import { decryptSecret, encryptSecret } from "@/server/utils/secret-box";

/**
 * Each branch's own gateway credentials.
 *
 * The restaurant is the merchant of record: it signs its own contract with
 * Safepay or a bank, gets its own keys, and the money settles into its own
 * account. We never hold anyone's funds. So credentials belong to a branch
 * rather than to the deployment, and there is no single `SAFEPAY_SECRET_KEY`
 * in the environment to reach for.
 *
 * Gateways differ in the *shape* of what they need, not only the values —
 * Safepay wants three fields, Easypaisa four, and JazzCash has a fourth that
 * only refunds use. So a provider declares its own fields and this module
 * knows nothing about any particular gateway. Adding one is a declaration, not
 * an edit here, and the settings screen renders whatever is declared without
 * per-gateway UI code.
 *
 * Three jobs, kept apart on purpose:
 *
 *   * `validateCredentials` — is this what the gateway asked for?
 *   * `sealCredentials` / `openCredentials` — at rest, and back again
 *   * `maskCredentials` — what may leave the server
 *
 * Nothing here touches the database; the service above it owns persistence, so
 * this is testable with no schema at all.
 */

export function credentialFields(providerName) {
  return getProvider(providerName).credentials ?? [];
}

/**
 * Binds a sealed value to exactly where it lives.
 *
 * Without this, an envelope copied from one row into another would still open,
 * and a branch could be pointed at a different restaurant's gateway account —
 * taking their money, or sending ours to them. The three parts are the three
 * things that must not change: whose branch, which gateway, which field.
 */
function aadFor({ branchId, provider, key }) {
  if (!branchId) throw new Error("A credential must be bound to a branch");
  return `${branchId}:${provider}:${key}`;
}

/**
 * Checks a submitted set against the gateway's declaration.
 *
 * Unknown fields are refused rather than dropped. A silently ignored typo is
 * how a gateway ends up half-configured and fails for the first real customer
 * instead of for whoever set it up.
 */
export function validateCredentials(providerName, values = {}, { partial = false } = {}) {
  const fields = credentialFields(providerName);
  const supplied = Object.keys(values ?? {});

  if (!fields.length) {
    if (supplied.length) {
      throw ApiError.validation(`${providerName} takes no credentials, but got: ${supplied.join(", ")}`, {
        credentials: [`${providerName} is settled outside the system and needs nothing configured`],
      });
    }
    return {};
  }

  const declared = new Set(fields.map((field) => field.key));
  const unknown = supplied.filter((key) => !declared.has(key));
  if (unknown.length) {
    throw ApiError.validation(`${providerName} has no credential field called ${unknown.join(", ")}`, {
      credentials: [`Expected only: ${[...declared].join(", ")}`],
    });
  }

  /*
   * `partial` checks only the fields that were actually supplied.
   *
   * An edit to one credential arrives carrying that field alone, because the
   * form renders empty boxes over the secrets it cannot display. Validating
   * such an edit as a complete set rejects it with "secretKey is required",
   * and the only way to satisfy that would be retyping every secret on every
   * save — which is precisely what the blank-means-unchanged rule exists to
   * avoid. Completeness is checked separately, by `assertReadyToEnable`, at
   * the one moment it matters: switching the gateway on.
   */
  const shape = {};
  for (const field of fields) {
    if (partial && !(field.key in values)) continue;
    shape[field.key] = field.required === false || partial ? field.schema.nullish() : field.schema;
  }

  const result = z.object(shape).strict().safeParse(values);
  if (!result.success) {
    const errors = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join(".") || "credentials";
      errors[path] = [...(errors[path] ?? []), issue.message];
    }
    const named = Object.keys(errors).join(", ");
    throw ApiError.validation(`These credentials are not usable: ${named}`, errors);
  }

  // Drop the keys a gateway left optional and the operator left empty, so an
  // absent field reads as absent rather than as a stored null.
  return Object.fromEntries(Object.entries(result.data).filter(([, value]) => value != null && value !== ""));
}

/**
 * Seals the secret fields for storage; leaves the public ones readable.
 *
 * A gateway's public key — Safepay's `sec_…`, which the checkout page hands to
 * the customer's browser — is already public by design. Encrypting it would
 * buy nothing and would stop the dashboard showing an operator which account
 * they actually pasted, which is the first thing anyone checks when payments
 * stop working.
 */
export function sealCredentials({ branchId, provider, values }) {
  const fields = credentialFields(provider);
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const out = {};

  for (const [key, value] of Object.entries(values ?? {})) {
    const field = byKey.get(key);
    if (!field) continue;

    /*
     * A blank box is not a credential, and must not become one.
     *
     * Sealing it would produce an envelope encrypting the empty string — a
     * perfectly non-empty string, which the merge then reads as a new value
     * and writes over the live credential. That is the blank-means-unchanged
     * rule defeated one layer below where it is enforced, so the emptiness
     * check belongs here too rather than only in the caller.
     *
     * Clearing a credential is an explicit `null`, and nulls are the caller's
     * to apply: they never reach this function.
     */
    const text = typeof value === "string" ? value.trim() : value;
    if (text == null || text === "") continue;

    out[key] = field.secret
      ? encryptSecret(String(text), { aad: aadFor({ branchId, provider, key }) })
      : String(text);
  }

  return out;
}

/**
 * Opens a stored set into the plaintext config a provider is called with.
 *
 * Throws rather than returning a partial set: a provider handed three of four
 * credentials would fail against the gateway in a way that looks like the
 * gateway's fault.
 */
export function openCredentials({ branchId, provider, stored }) {
  const fields = credentialFields(provider);
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const out = {};

  for (const [key, value] of Object.entries(stored ?? {})) {
    const field = byKey.get(key);
    // A field that was dropped from the declaration since it was saved. Left
    // behind rather than returned, so a renamed field cannot resurface under
    // its old name and quietly take effect.
    if (!field || value == null) continue;
    out[key] = field.secret ? decryptSecret(String(value), { aad: aadFor({ branchId, provider, key }) }) : String(value);
  }

  return out;
}

/**
 * What the API may return: whether each field is set, never what it is.
 *
 * A masked secret is not a secret that may be shown "just a bit" — no prefix,
 * no last four. A gateway key is short and structured enough that a hint is a
 * real head start, and there is no legitimate reason for a dashboard to echo
 * one back. The public fields are returned in full, because they are public.
 */
export function maskCredentials({ provider, stored }) {
  return credentialFields(provider).map((field) => {
    const value = stored?.[field.key];
    const isSet = value != null && value !== "";

    return {
      key: field.key,
      label: field.label,
      hint: field.hint ?? null,
      secret: field.secret,
      required: field.required !== false,
      isSet,
      value: field.secret ? null : isSet ? String(value) : "",
    };
  });
}

/**
 * Folds a submitted edit into what is already stored.
 *
 * The screen cannot show a secret, so it renders an empty box over a value
 * that is already set. That makes "empty" ambiguous, and the ambiguity is
 * dangerous in one direction only: if an empty box cleared the field, saving
 * an unrelated change on that screen would silently break a live gateway and
 * the next customer would be the one to find out.
 *
 * So the rule is: **omitted or blank means leave it alone; an explicit `null`
 * clears it.** A caller that genuinely wants a credential gone has to say so.
 *
 * `changed` carries field *names* only. It is what the audit log records, and
 * an audit trail that quotes the credential is just a second copy of it in a
 * table more people can read than the one it came from.
 */
export function mergeCredentialUpdate({ fields, existing = {}, submitted = {} }) {
  const values = { ...existing };
  const changed = [];

  for (const field of fields) {
    if (!(field.key in submitted)) continue;
    const incoming = submitted[field.key];

    if (incoming === null) {
      if (values[field.key] !== undefined) {
        delete values[field.key];
        changed.push(field.key);
      }
      continue;
    }

    // Trimmed before the emptiness test, so a box containing only spaces is
    // treated as untouched rather than saved as a credential made of spaces.
    const text = typeof incoming === "string" ? incoming.trim() : incoming;
    if (text === "" || text === undefined) continue;

    if (values[field.key] !== text) {
      values[field.key] = text;
      changed.push(field.key);
    }
  }

  return { values, changed };
}

/**
 * Refuses to switch a gateway on while it is still half-configured.
 *
 * Checked against the *stored* set rather than the submitted one, because a
 * gateway can be enabled on a request that changes nothing else — and a
 * missing credential would otherwise surface at checkout, after the customer
 * has already chosen their food.
 */
export function assertReadyToEnable({ provider, values = {} }) {
  const missing = credentialFields(provider)
    .filter((field) => field.required !== false)
    .filter((field) => {
      const value = values[field.key];
      return value == null || String(value).trim() === "";
    })
    .map((field) => field.key);

  if (missing.length) {
    throw ApiError.validation(`${provider} cannot be switched on until it has: ${missing.join(", ")}`, {
      credentials: missing.map((key) => `${key} is required before this gateway can take payments`),
    });
  }
}

/**
 * Whether this gateway cannot be used until somebody configures it.
 *
 * True only when it declares a credential it genuinely needs. Two kinds of
 * provider must keep working with no row at all: cash, which has nothing to
 * authenticate against, and the fake gateway, whose secret falls back to the
 * deployment's environment so the test suite and a fresh checkout both work
 * before any branch has been set up.
 *
 * Without this distinction, resolving a config threw "not set up for this
 * branch" for every provider that declared any field, which broke every
 * existing online payment the moment the fake gateway grew a credential.
 */
export function requiresConfiguration(provider) {
  return credentialFields(provider).some((field) => field.required !== false);
}

/**
 * What to call a gateway on screen.
 *
 * A branch's own wording wins. "Safepay" means nothing to most diners while
 * "Card / Easypaisa / JazzCash" means everything, and the wording that works
 * in one neighbourhood is not the wording that works in another — so the
 * override is per branch rather than a single setting.
 *
 * Falling back to the provider's declared label, never to the registry key:
 * "safepay" in lower case on a checkout page reads as a bug. A key with no
 * registered provider still has to render as something, because a row can
 * outlive the provider that created it.
 */
export function providerLabel(provider, override = null) {
  const chosen = typeof override === "string" ? override.trim() : "";
  if (chosen) return chosen;

  try {
    const declared = getProvider(provider).label;
    if (declared) return declared;
  } catch {
    // Configured under a name nothing is registered under any more.
  }

  return String(provider ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The line of copy shown under a gateway's option at checkout, if it has one. */
export function providerDescription(provider) {
  try {
    return getProvider(provider).description ?? null;
  } catch {
    return null;
  }
}
