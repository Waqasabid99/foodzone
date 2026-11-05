/**
 * Words and form rules for the administration screens: accounts, roles and
 * the permissions between them.
 *
 * Pure, so the rules a form enforces before sending are tested beside the
 * words it shows. The server checks all of it again — this only saves a round
 * trip and puts the message next to the box that caused it.
 */

export const USER_STATES = {
  PENDING_VERIFICATION: { label: "Invited", tone: "bg-warning-container text-on-warning-container" },
  ACTIVE: { label: "Active", tone: "bg-success-container text-on-success-container" },
  SUSPENDED: { label: "Suspended", tone: "bg-error-container text-on-error-container" },
  DEACTIVATED: { label: "Deactivated", tone: "bg-surface-container-high text-on-surface-variant" },
};

export const ROLE_SCOPES = [
  { value: "BRANCH", label: "One branch at a time", hint: "Granted per outlet: a manager at Downtown is not a manager everywhere." },
  { value: "GLOBAL", label: "The whole company", hint: "Covers every branch, including ones added later." },
];

/** Seniority bands, so a number on screen means something. */
export const ROLE_LEVELS = [
  { value: 10, label: "10 — Owner or director" },
  { value: 20, label: "20 — Operations" },
  { value: 30, label: "30 — Department head" },
  { value: 40, label: "40 — Supervisor" },
  { value: 50, label: "50 — Staff" },
  { value: 60, label: "60 — Limited" },
];

/** "Branch Manager at Downtown, Cashier at Airport" — or what to do about nobody. */
export function roleSummary(roles = []) {
  if (!roles.length) return "No role yet — this account can sign in but do nothing.";
  return roles
    .map((role) => {
      const name = role.name ?? role.key;
      const where = role.branch?.name ?? (role.branchId ? "one branch" : null);
      return where ? `${name} at ${where}` : name;
    })
    .join(", ");
}

/** A grant that has run out is kept but no longer counts. */
export function grantExpired(role, now = new Date()) {
  return Boolean(role?.expiresAt && new Date(role.expiresAt) <= now);
}

export function userPayload(form) {
  const errors = {};
  const name = String(form.name ?? "").trim();
  if (name.length < 2) errors.name = "Enter their name.";
  else if (name.length > 80) errors.name = "Keep it under 80 characters.";

  const email = String(form.email ?? "").trim().toLowerCase();
  if (!email) errors.email = "An email address is where the invitation goes.";
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = "That does not look like an email address.";

  const phone = String(form.phone ?? "").trim();
  if (phone && (phone.length < 7 || phone.length > 20)) errors.phone = "Enter a valid phone number.";

  const roleIds = (form.roleIds ?? []).filter(Boolean);
  if (!roleIds.length) errors.roleIds = "Choose at least one role — an account with none can do nothing.";

  // A branch-scoped role has to say which branch, or the grant covers nothing.
  if (form.needsBranch && !form.branchId) errors.branchId = "Choose the branch this applies to.";

  return {
    body: {
      name,
      email,
      ...(phone ? { phone } : {}),
      roleIds,
      ...(form.branchId ? { branchId: form.branchId } : {}),
    },
    errors,
  };
}

export function rolePayload(form, { mode = "create" } = {}) {
  const errors = {};
  const name = String(form.name ?? "").trim();
  if (name.length < 2) errors.name = "Give the role a name.";
  else if (name.length > 60) errors.name = "Keep it under 60 characters.";

  const description = String(form.description ?? "").trim();
  if (description.length > 300) errors.description = "Keep it under 300 characters.";

  const level = Number(form.level);
  if (!Number.isInteger(level) || level < 1 || level > 100) errors.level = "Choose how senior this role is.";

  const scope = form.scope === "GLOBAL" ? "GLOBAL" : "BRANCH";
  const permissionKeys = [...new Set(form.permissionKeys ?? [])];
  if (mode === "create" && !permissionKeys.length) errors.permissionKeys = "A role with no permissions can do nothing.";

  return {
    body: {
      name,
      description: description || null,
      scope,
      level,
      ...(mode === "create" ? { permissionKeys } : {}),
    },
    permissionKeys,
    errors,
  };
}

/** A whole module's permissions, for the "select all in this module" box. */
export function moduleState(keysInModule, selected) {
  const chosen = keysInModule.filter((key) => selected.includes(key));
  if (!chosen.length) return "none";
  return chosen.length === keysInModule.length ? "all" : "some";
}

export function toggleModule(keysInModule, selected) {
  return moduleState(keysInModule, selected) === "all"
    ? selected.filter((key) => !keysInModule.includes(key))
    : [...new Set([...selected, ...keysInModule])];
}

/** What a device is, from the user agent string, in words a manager knows. */
export function deviceLabel(session) {
  const agent = String(session?.userAgent ?? "");
  const client = session?.client === "WEB" ? "Browser" : session?.client === "IOS" ? "iPhone app" : session?.client === "ANDROID" ? "Android app" : "Device";
  const os = /Windows/i.test(agent)
    ? "Windows"
    : /Macintosh|Mac OS/i.test(agent)
      ? "Mac"
      : /Android/i.test(agent)
        ? "Android"
        : /iPhone|iPad|iOS/i.test(agent)
          ? "iOS"
          : /Linux/i.test(agent)
            ? "Linux"
            : null;
  const browser = /Edg\//i.test(agent)
    ? "Edge"
    : /Chrome\//i.test(agent)
      ? "Chrome"
      : /Safari\//i.test(agent) && !/Chrome/i.test(agent)
        ? "Safari"
        : /Firefox\//i.test(agent)
          ? "Firefox"
          : null;
  return [client, browser, os].filter(Boolean).join(" · ");
}

// --- document numbering -----------------------------------------------------

/** What a document number will look like, exactly as the server builds it. */
export function previewNumber({ prefix = "", periodKey = null, value = 1, padding = 4 }) {
  const digits = Math.max(1, Math.min(10, Number(padding) || 4));
  return [String(prefix ?? "").trim(), periodKey, String(value).padStart(digits, "0")].filter(Boolean).join("-");
}

export function sequencePayload(form, { nextValue = 1 } = {}) {
  const errors = {};
  const prefix = String(form.prefix ?? "").trim();
  if (prefix && !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(prefix)) errors.prefix = "Letters, numbers and hyphens only.";
  else if (prefix.length > 20) errors.prefix = "Keep it to 20 characters.";

  const padding = Number(form.padding);
  if (!Number.isInteger(padding) || padding < 1 || padding > 10) errors.padding = "Between 1 and 10 digits.";
  else if (String(nextValue).length > padding) {
    errors.padding = `This counter is already at ${nextValue}, so it needs at least ${String(nextValue).length} digits.`;
  }

  return { body: { prefix, padding }, errors };
}
