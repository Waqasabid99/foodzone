import fs from "node:fs";
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions, warmUpDatabase } from "../src/lib/db-pool.js";
import { PERMISSION_MODULES } from "../prisma/seeds/permissions.js";
import { SYSTEM_ROLES } from "../prisma/seeds/roles.js";

const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const LOG = process.env.E2E_LOG ?? "/tmp/foodzone-e2e-server.log";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });

const stamp = Date.now();
const emailOf = (tag) => `e2e-${stamp}-${tag}@example.test`;
const createdUserIds = new Set();
const createdRoleIds = new Set();

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { passed++; console.log("PASS ", name); }
  else { failures.push(name); console.log("FAIL ", name, detail !== undefined ? "::" + JSON.stringify(detail).slice(0, 300) : ""); }
}

let ipCounter = 0;
/**
 * Anonymous rate limits key off the client IP, so unrelated test cases must not
 * share one — otherwise the suite throttles itself. Each call gets its own
 * source address unless a test deliberately reuses one.
 */
function nextIp() {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

async function api(path, { method = "GET", body, token, headers = {}, ip } = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip ?? nextIp(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, body: json, headers: res.headers };
}

/**
 * Refuse to run against a server that can actually send mail.
 *
 * This phase reads verification codes out of the server log, and they are only
 * there when the mailer falls back to its console driver — which it does when
 * SMTP_HOST is unset. With real SMTP credentials in `.env` two things happen
 * at once: the codes become invisible (so the suite fails for a reason that
 * looks like a bug in authentication), and every run pushes a dozen messages
 * at the provider under the project's own sending domain. Registrations,
 * invites and password resets all mail somebody.
 *
 * So the suite stops instead. `npm run test:e2e:server` starts a server with
 * SMTP blanked and exports E2E_MAIL=console; set that variable yourself if you
 * started the server some other way with the console driver.
 */
function assertConsoleMailDriver() {
  if (process.env.E2E_MAIL === "console") return;
  if (!process.env.SMTP_HOST) return;
  console.log(
    [
      "FAIL  phase 1 needs the console mail driver",
      "",
      `  SMTP_HOST is set to ${JSON.stringify(process.env.SMTP_HOST)} in .env, so the server under test`,
      "  sends verification codes to the provider instead of printing them.",
      "  This suite cannot read them, and the run would mail real messages.",
      "",
      "  Start the server with:  npm run test:e2e:server",
      "  Then run the suite with: E2E_MAIL=console node tests/phase1.e2e.mjs",
    ].join("\n"),
  );
  process.exit(1);
}

/**
 * Codes are hashed in the database, so read them from the console mail driver.
 *
 * The log is JSON per line, so the message body arrives with its newlines
 * escaped: a code sitting on its own line reads as `...account.\\n\\n915255\\n\\n`
 * in the raw text. Searching that text for `\\b\\d{6}\\b` finds nothing, because the
 * `n` of the escape is a word character and kills the boundary — which is why
 * this used to read verification codes (they are in the subject line, next to
 * a quote) but never invitation codes (body only). Decode the line first and
 * search the real string.
 */
async function waitForCode(email, { timeoutMs = 8000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const log = fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8") : "";
    const lines = log.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes("email (console driver") || !lines[i].includes(email)) continue;
      let entry = null;
      try { entry = JSON.parse(lines[i]); } catch { entry = null; }
      // `to` must match exactly: a substring hit on the raw line could have come
      // from a different recipient mentioned in the same body.
      if (!entry || entry.to !== email) break;
      const match = `${entry.subject ?? ""}\n${entry.preview ?? ""}`.match(/\b(\d{6})\b/);
      if (match) return match[1];
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const log = fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8") : "";
  if (log.includes("email sent")) {
    throw new Error(
      `no emailed code found for ${email} — the server logged "email sent", so it is on SMTP, not the console driver. ` +
        "Restart it with npm run test:e2e:server.",
    );
  }
  throw new Error(`no emailed code found for ${email} (log: ${LOG})`);
}

async function main() {
  /*
   * ===================== FIRST-RUN SETUP =====================
   *
   * The one endpoint that creates an administrator with nobody signed in, so
   * its guards are the whole of its security and they are checked here rather
   * than trusted.
   *
   * This has to run before anything else registers a user, because "has this
   * installation been claimed" is the guard being tested. On the canonical
   * run — a database built from empty — the full path exercises; on a
   * database that already has users, the only honest thing left to assert is
   * that setup refuses, which is checked too.
   */
  const SETUP_TOKEN = process.env.E2E_SETUP_TOKEN ?? "e2e-setup-token";
  const setupBody = {
    owner: { name: "Setup Owner", email: emailOf("owner"), password: "a-long-enough-passphrase" },
    branch: { code: `SU${String(stamp).slice(-6)}`, name: "Setup Branch", city: "Karachi" },
  };
  const postSetup = (token, body = setupBody) =>
    api("/setup", { method: "POST", body, headers: token ? { "x-setup-token": token } : {} });

  const unclaimed = (await prisma.user.count()) === 0;

  if (unclaimed) {
    const noToken = await postSetup(null);
    check("setup without a token is not found, not forbidden", noToken.status === 404, noToken.status);

    const wrongToken = await postSetup("definitely-not-the-token");
    check("setup with the wrong token is refused", wrongToken.status === 404, wrongToken.status);

    const stillEmpty = await prisma.user.count();
    check("a refused setup creates nothing", stillEmpty === 0, stillEmpty);

    const done = await postSetup(SETUP_TOKEN);
    check("setup with the token creates the owner and the first branch", done.status === 201, done.body);
    check("the branch code is upper-cased like every other", done.body?.data?.branch?.code === setupBody.branch.code.toUpperCase(), done.body?.data?.branch);
    check("and defaults to this country's timezone and currency", done.body?.data?.branch?.timezone === "Asia/Karachi" && done.body?.data?.branch?.currency === "PKR", done.body?.data?.branch);

    const owner = await prisma.user.findUnique({
      where: { email: setupBody.owner.email },
      select: { id: true, status: true, isSuperAdmin: true, emailVerifiedAt: true },
    });
    check("the owner can actually sign in: active, verified, super admin", owner?.status === "ACTIVE" && owner?.isSuperAdmin === true && !!owner?.emailVerifiedAt, owner);

    const again = await postSetup(SETUP_TOKEN, {
      owner: { name: "Second Owner", email: emailOf("owner2"), password: "a-long-enough-passphrase" },
      branch: { code: `S2${String(stamp).slice(-6)}`, name: "Second Branch" },
    });
    check("setup cannot be run twice, even with the right token", again.status === 404, again.status);
    check("and the second owner was not created", (await prisma.user.count()) === 1, await prisma.user.count());

    // Removed immediately: the rest of this suite assumes it is building an
    // installation from nothing, and an extra owner and branch would show up
    // in its counts.
    await prisma.branch.deleteMany({ where: { id: done.body.data.branch.id } });
    await prisma.user.deleteMany({ where: { id: done.body.data.owner.id } });
  } else {
    const claimed = await postSetup(SETUP_TOKEN);
    check("setup refuses on an installation that already has users", claimed.status === 404, claimed.status);
  }

  // ===================== AUTH =====================
  const custEmail = emailOf("customer");
  const reg = await api("/auth/register", { method: "POST", body: { name: "E2E Customer", email: custEmail, password: "correct-horse-1", client: "ios" } });
  check("register returns 201 + session", reg.status === 201 && !!reg.body?.data?.accessToken, reg.body);
  check("register flags verification required", reg.body?.data?.emailVerificationRequired === true);
  check("register assigns the customer role", reg.body?.data?.user?.roles?.[0]?.key === "customer", reg.body?.data?.user?.roles);
  check("register status is PENDING_VERIFICATION", reg.body?.data?.user?.status === "PENDING_VERIFICATION");
  check("register sets httpOnly cookies", (reg.headers.get("set-cookie") ?? "").includes("fz_access"));
  check("response carries x-request-id", !!reg.headers.get("x-request-id"));
  const custUserId = reg.body.data.user.id;
  createdUserIds.add(custUserId);
  let custToken = reg.body.data.accessToken;
  let custRefresh = reg.body.data.refreshToken;

  const dupe = await api("/auth/register", { method: "POST", body: { name: "Dupe", email: custEmail, password: "correct-horse-1" } });
  check("duplicate email is 409 CONFLICT", dupe.status === 409 && dupe.body?.error?.code === "CONFLICT");

  const weak = await api("/auth/register", { method: "POST", body: { name: "X", email: emailOf("weak"), password: "short" } });
  check("weak password + short name rejected with field details", weak.status === 400 && !!weak.body?.error?.details?.password && !!weak.body?.error?.details?.name, weak.body?.error);

  const me = await api("/auth/me", { token: custToken });
  check("me returns the principal", me.status === 200 && me.body?.data?.email === custEmail);
  check("me exposes resolved permissions", Array.isArray(me.body?.data?.permissions) && me.body.data.permissions.includes("self.view_profile"), me.body?.data?.permissions);
  check("me reports emailVerified false", me.body?.data?.emailVerified === false);

  const noAuth = await api("/auth/me");
  check("me without a token is 401", noAuth.status === 401 && noAuth.body?.error?.code === "UNAUTHORIZED");
  const badAuth = await api("/auth/me", { token: "not-a-jwt" });
  check("me with a garbage token is 401", badAuth.status === 401);

  // ---- email verification
  const code = await waitForCode(custEmail);
  check("verification email was sent with a 6-digit code", /^\d{6}$/.test(code));
  const wrongCode = await api("/auth/email/verify", { method: "POST", body: { code: "000000" }, token: custToken });
  check("wrong verification code is rejected", wrongCode.status === 400, wrongCode.body?.error);
  const resend = await api("/auth/email/verify/resend", { method: "POST", token: custToken });
  check("resend inside the cooldown is 429 with Retry-After", resend.status === 429 && !!resend.headers.get("retry-after"), resend.body?.error);
  const verified = await api("/auth/email/verify", { method: "POST", body: { code }, token: custToken });
  check("correct code verifies the email", verified.status === 200 && verified.body?.data?.verified === true, verified.body);
  const meVerified = await api("/auth/me", { token: custToken });
  check("account becomes ACTIVE after verification", meVerified.body?.data?.status === "ACTIVE" && meVerified.body?.data?.emailVerified === true);

  // ---- login
  const badLogin = await api("/auth/login", { method: "POST", body: { email: custEmail, password: "wrong-password-x" } });
  check("wrong password is 401", badLogin.status === 401);
  const unknownLogin = await api("/auth/login", { method: "POST", body: { email: emailOf("ghost"), password: "wrong-password-x" } });
  check("unknown email gives the same 401 message", unknownLogin.status === 401 && unknownLogin.body?.error?.message === badLogin.body?.error?.message);

  const login = await api("/auth/login", { method: "POST", body: { email: custEmail, password: "correct-horse-1", client: "android" } });
  check("login succeeds", login.status === 200 && !!login.body?.data?.accessToken);
  custToken = login.body.data.accessToken;
  custRefresh = login.body.data.refreshToken;

  // ---- refresh rotation + reuse detection
  const refreshed = await api("/auth/refresh", { method: "POST", body: { refreshToken: custRefresh } });
  check("refresh rotates the token", refreshed.status === 200 && refreshed.body?.data?.refreshToken !== custRefresh);
  const rotatedToken = refreshed.body.data.accessToken;
  const rotatedRefresh = refreshed.body.data.refreshToken;

  const reuse = await api("/auth/refresh", { method: "POST", body: { refreshToken: custRefresh } });
  check("replaying a used refresh token is 401", reuse.status === 401);
  const afterReuse = await api("/auth/me", { token: rotatedToken });
  check("reuse detection revokes the whole session family", afterReuse.status === 401, afterReuse.body);
  const rotatedAfterBreach = await api("/auth/refresh", { method: "POST", body: { refreshToken: rotatedRefresh } });
  check("the rotated token is dead too after a breach", rotatedAfterBreach.status === 401);

  // ---- sessions
  const s1 = await api("/auth/login", { method: "POST", body: { email: custEmail, password: "correct-horse-1", client: "web" } });
  const s2 = await api("/auth/login", { method: "POST", body: { email: custEmail, password: "correct-horse-1", client: "ios" } });
  custToken = s2.body.data.accessToken;
  const sessions = await api("/auth/sessions", { token: custToken });
  check("sessions lists both devices", sessions.status === 200 && sessions.body.data.length === 2, sessions.body?.data?.length);
  check("current session is flagged", sessions.body.data.filter((s) => s.current).length === 1);
  const other = sessions.body.data.find((s) => !s.current);
  const revoked = await api(`/auth/sessions/${other.id}`, { method: "DELETE", token: custToken });
  check("revoking one session works", revoked.status === 200);
  const afterRevoke = await api("/auth/me", { token: s1.body.data.accessToken });
  check("the revoked device is locked out", afterRevoke.status === 401);

  // ---- password change
  const change = await api("/auth/password/change", { method: "POST", token: custToken, body: { currentPassword: "wrong-one-here", newPassword: "brand-new-passphrase" } });
  check("password change with a wrong current password is 400", change.status === 400);
  const changed = await api("/auth/password/change", { method: "POST", token: custToken, body: { currentPassword: "correct-horse-1", newPassword: "brand-new-passphrase" } });
  check("password change returns a fresh session", changed.status === 200 && !!changed.body?.data?.accessToken);
  const oldTokenAfterChange = await api("/auth/me", { token: custToken });
  check("the old access token dies on password change", oldTokenAfterChange.status === 401);
  const newTokenAfterChange = await api("/auth/me", { token: changed.body.data.accessToken });
  check("the issuing device stays signed in", newTokenAfterChange.status === 200);
  custToken = changed.body.data.accessToken;

  // ---- forgot / reset
  const forgotUnknown = await api("/auth/password/forgot", { method: "POST", body: { email: emailOf("nobody") } });
  check("forgot-password does not leak whether the account exists", forgotUnknown.status === 200 && forgotUnknown.body?.data?.sent === true);
  await prisma.credentialToken.updateMany({ where: { userId: custUserId, type: "PASSWORD_RESET" }, data: { createdAt: new Date(0) } });
  const forgot = await api("/auth/password/forgot", { method: "POST", body: { email: custEmail } });
  check("forgot-password accepted for a real account", forgot.status === 200);
  const resetCode = await waitForCode(custEmail);
  const reset = await api("/auth/password/reset", { method: "POST", body: { email: custEmail, code: resetCode, password: "third-password-here" } });
  check("password reset succeeds", reset.status === 200 && reset.body?.data?.reset === true, reset.body);
  const afterReset = await api("/auth/me", { token: custToken });
  check("reset signs out every device", afterReset.status === 401);
  const loginAfterReset = await api("/auth/login", { method: "POST", body: { email: custEmail, password: "third-password-here" } });
  check("login works with the new password", loginAfterReset.status === 200);
  custToken = loginAfterReset.body.data.accessToken;

  // ===================== PROFILE + ADDRESSES =====================
  const patchProfile = await api("/me", { method: "PATCH", token: custToken, body: { name: "E2E Renamed", phone: "+92 300 1234567" } });
  check("profile update works", patchProfile.status === 200 && patchProfile.body?.data?.name === "E2E Renamed", patchProfile.body);
  const emptyPatch = await api("/me", { method: "PATCH", token: custToken, body: {} });
  check("empty profile update is rejected", emptyPatch.status === 400);

  const addr1 = await api("/addresses", { method: "POST", token: custToken, body: { label: "Home", phone: "+923001234567", line1: "12 Test Street", city: "Karachi", state: "Sindh", postalCode: "75500" } });
  check("first address is created as default", addr1.status === 201 && addr1.body?.data?.isDefault === true, addr1.body);
  const addr2 = await api("/addresses", { method: "POST", token: custToken, body: { label: "Office", phone: "+923009999999", line1: "44 Work Road", city: "Lahore", state: "Punjab", postalCode: "54000", isDefault: true } });
  check("second address can claim default", addr2.status === 201 && addr2.body?.data?.isDefault === true);
  const list = await api("/addresses", { token: custToken });
  check("only one address is default", list.body.data.filter((a) => a.isDefault).length === 1, list.body?.data);
  const unsetDefault = await api(`/addresses/${addr2.body.data.id}`, { method: "PATCH", token: custToken, body: { isDefault: false } });
  check("the last default cannot be unset", unsetDefault.status === 400);
  const setBack = await api(`/addresses/${addr1.body.data.id}/default`, { method: "POST", token: custToken });
  check("default can be moved", setBack.status === 200 && setBack.body.data.find((a) => a.id === addr1.body.data.id).isDefault === true);
  const del = await api(`/addresses/${addr1.body.data.id}`, { method: "DELETE", token: custToken });
  check("address delete returns 204", del.status === 204);
  const afterDelete = await api("/addresses", { token: custToken });
  check("deleting the default promotes another", afterDelete.body.data.length === 1 && afterDelete.body.data[0].isDefault === true);
  const foreign = await api(`/addresses/${addr1.body.data.id}`, { token: custToken });
  check("a deleted address is not readable", foreign.status === 404);

  // ===================== ADMIN =====================
  // A super admin is required to exercise the admin surface. Created directly,
  // and removed again in cleanup.
  const adminEmail = emailOf("admin");
  const adminReg = await api("/auth/register", { method: "POST", body: { name: "E2E Admin", email: adminEmail, password: "admin-passphrase-1" } });
  const adminId = adminReg.body.data.user.id;
  createdUserIds.add(adminId);
  await prisma.user.update({ where: { id: adminId }, data: { isSuperAdmin: true, status: "ACTIVE", emailVerifiedAt: new Date() } });
  const adminLogin = await api("/auth/login", { method: "POST", body: { email: adminEmail, password: "admin-passphrase-1" } });
  const adminToken = adminLogin.body.data.accessToken;

  const denied = await api("/admin/users", { token: custToken });
  check("a customer cannot list users", denied.status === 403 && Array.isArray(denied.body?.error?.details?.required), denied.body?.error);

  // Counted from the seed definition rather than written down here. A literal
  // goes stale the first time somebody adds a permission, and then fails for a
  // reason that has nothing to do with authentication.
  const expectedModules = PERMISSION_MODULES.length;
  const expectedPermissions = PERMISSION_MODULES.reduce((sum, m) => sum + m.actions.length, 0);

  const perms = await api("/admin/permissions", { token: adminToken });
  check("permission catalogue is readable", perms.status === 200 && perms.body?.data?.total === expectedPermissions, { got: perms.body?.data?.total, expected: expectedPermissions });
  check("permissions are grouped by module", perms.body?.data?.modules?.length === expectedModules, { got: perms.body?.data?.modules?.length, expected: expectedModules });

  // The two above compare the endpoint to the seed *file*. This one compares
  // the database to it, so a catalogue that was edited without re-seeding is
  // named as such instead of surfacing as a mystery count.
  const seededPermissions = await prisma.permission.count();
  check("the seeded catalogue matches the seed file", seededPermissions === expectedPermissions, { database: seededPermissions, seedFile: expectedPermissions, hint: "run npm run db:seed" });

  // Counted from the seed, and admin-created roles are allowed on top. The
  // literal 20 went stale the moment somebody made a role of their own, and
  // then failed for a reason that has nothing to do with authentication.
  const roles = await api("/admin/roles", { token: adminToken });
  const seededRoles = roles.body?.data?.filter((row) => row.isSystem !== false) ?? [];
  check("roles list returns every seeded role", roles.status === 200 && seededRoles.length === SYSTEM_ROLES.length, {
    seeded: seededRoles.length,
    expected: SYSTEM_ROLES.length,
    total: roles.body?.data?.length,
  });

  const sysRole = roles.body.data.find((r) => r.key === "cashier");
  const editSystem = await api(`/admin/roles/${sysRole.id}`, { method: "PATCH", token: adminToken, body: { name: "Hacked" } });
  check("system roles cannot be edited", editSystem.status === 403, editSystem.body?.error);
  const deleteSystem = await api(`/admin/roles/${sysRole.id}`, { method: "DELETE", token: adminToken });
  check("system roles cannot be deleted", deleteSystem.status === 403);

  const newRole = await api("/admin/roles", { method: "POST", token: adminToken, body: { name: `E2E Menu Editor ${stamp}`, scope: "GLOBAL", level: 40, permissionKeys: ["products.read", "products.update", "menus.read"] } });
  check("custom role is created with its permissions", newRole.status === 201 && newRole.body?.data?.permissionCount === 3, newRole.body);
  const roleId = newRole.body.data.id;
  createdRoleIds.add(roleId);

  const badPerm = await api(`/admin/roles/${roleId}/permissions`, { method: "PUT", token: adminToken, body: { permissionKeys: ["not.a.real.permission"] } });
  check("unknown permission keys are rejected", badPerm.status === 400 && !!badPerm.body?.error?.details?.permissionKeys);

  const setPerms = await api(`/admin/roles/${roleId}/permissions`, { method: "PUT", token: adminToken, body: { permissionKeys: ["products.read"] } });
  check("PUT replaces the permission set (revokes the difference)", setPerms.status === 200 && setPerms.body.data.permissionCount === 1, setPerms.body?.data);

  // ---- staff invitation
  const staffEmail = emailOf("staff");
  const invited = await api("/admin/users", { method: "POST", token: adminToken, body: { name: "E2E Staff", email: staffEmail, roleIds: [roleId] } });
  check("staff account is created and invited", invited.status === 201 && invited.body?.data?.invitePending === true, invited.body);
  const staffId = invited.body.data.id;
  createdUserIds.add(staffId);
  check("invited staff has no password yet", invited.body?.data?.hasPassword === false);

  const staffLoginBefore = await api("/auth/login", { method: "POST", body: { email: staffEmail, password: "anything-at-all" } });
  check("an unaccepted invite cannot log in", staffLoginBefore.status === 401);

  const inviteCode = await waitForCode(staffEmail);
  const accepted = await api("/auth/invitations/accept", { method: "POST", body: { email: staffEmail, code: inviteCode, password: "staff-passphrase-1" } });
  check("invitation acceptance returns a session", accepted.status === 200 && !!accepted.body?.data?.accessToken, accepted.body);
  check("accepting the invite verifies the email", accepted.body?.data?.user?.emailVerified === true && accepted.body?.data?.user?.status === "ACTIVE");
  let staffToken = accepted.body.data.accessToken;
  const reAccept = await api("/auth/invitations/accept", { method: "POST", body: { email: staffEmail, code: inviteCode, password: "another-passphrase" } });
  check("an invitation cannot be accepted twice", reAccept.status === 409);

  // ---- the granted role actually grants
  const staffMe = await api("/auth/me", { token: staffToken });
  check("staff holds the assigned role", staffMe.body?.data?.roles?.some((r) => r.id ?? r.key), staffMe.body?.data?.roles);
  check("staff permissions come from the role", staffMe.body?.data?.permissions?.includes("products.read"), staffMe.body?.data?.permissions);
  const staffAdminAttempt = await api("/admin/roles", { token: staffToken });
  check("staff without roles.read is refused", staffAdminAttempt.status === 403);

  // ---- per-user overrides
  const allow = await api(`/admin/users/${staffId}/permissions`, { method: "POST", token: adminToken, body: { permissionKey: "roles.read", effect: "ALLOW", reason: "e2e" } });
  check("ALLOW override is created", allow.status === 200 && allow.body.data.length === 1, allow.body);
  const staffAfterAllow = await api("/admin/roles", { token: staffToken });
  check("ALLOW override grants access immediately", staffAfterAllow.status === 200, staffAfterAllow.body?.error);

  const deny = await api(`/admin/users/${staffId}/permissions`, { method: "POST", token: adminToken, body: { permissionKey: "products.read", effect: "DENY", reason: "e2e" } });
  check("DENY override is created", deny.status === 200);
  const staffMeAfterDeny = await api("/auth/me", { token: staffToken });
  check("DENY beats the role grant", !staffMeAfterDeny.body?.data?.permissions?.includes("products.read"), staffMeAfterDeny.body?.data?.permissions);

  const overrides = await api(`/admin/users/${staffId}/permissions`, { token: adminToken });
  const denyId = overrides.body.data.find((o) => o.effect === "DENY").id;
  const removeOverride = await api(`/admin/users/${staffId}/permissions/${denyId}`, { method: "DELETE", token: adminToken });
  check("override can be removed", removeOverride.status === 200 && removeOverride.body.data.length === 1);
  const staffMeAfterRemove = await api("/auth/me", { token: staffToken });
  check("removing DENY restores the role grant", staffMeAfterRemove.body?.data?.permissions?.includes("products.read"));

  // ---- privilege escalation guards
  const escalateRole = await api("/admin/roles", { method: "POST", token: staffToken, body: { name: `E2E Escalation ${stamp}`, permissionKeys: ["users.delete"] } });
  check("staff cannot create roles without roles.create", escalateRole.status === 403, escalateRole.body?.error);

  await api(`/admin/users/${staffId}/permissions`, { method: "POST", token: adminToken, body: { permissionKey: "roles.create", effect: "ALLOW" } });
  const escalate2 = await api("/admin/roles", { method: "POST", token: staffToken, body: { name: `E2E Escalation ${stamp}`, level: 60, permissionKeys: ["users.delete"] } });
  check("cannot put a permission you lack into a new role", escalate2.status === 403 && escalate2.body?.error?.details?.missing?.includes("users.delete"), escalate2.body?.error);

  const escalate3 = await api("/admin/roles", { method: "POST", token: staffToken, body: { name: `E2E Senior ${stamp}`, level: 5, permissionKeys: [] } });
  check("cannot create a role more senior than yourself", escalate3.status === 403, escalate3.body?.error);

  // ---- role assignment guards
  const adminRole = roles.body.data.find((r) => r.key === "admin");
  await api(`/admin/users/${staffId}/permissions`, { method: "POST", token: adminToken, body: { permissionKey: "roles.assign", effect: "ALLOW" } });
  const grantAdmin = await api(`/admin/users/${staffId}/roles`, { method: "POST", token: staffToken, body: { roleId: adminRole.id } });
  check("cannot grant a role at or above your own level", grantAdmin.status === 403, grantAdmin.body?.error);

  const branchScoped = roles.body.data.find((r) => r.key === "cashier");
  const noBranch = await api(`/admin/users/${custUserId}/roles`, { method: "POST", token: staffToken, body: { roleId: branchScoped.id } });
  check("branch-scoped role needs a branch (non-super-admin)", noBranch.status === 400, noBranch.body?.error);

  const dupeRole = await api(`/admin/users/${staffId}/roles`, { method: "POST", token: adminToken, body: { roleId } });
  check("duplicate role assignment is 409", dupeRole.status === 409, dupeRole.body?.error);

  const userRoles = await api(`/admin/users/${staffId}/roles`, { token: adminToken });
  const assignmentId = userRoles.body.data[0].id;
  const revokeRole = await api(`/admin/users/${staffId}/roles/${assignmentId}`, { method: "DELETE", token: adminToken });
  check("role can be revoked", revokeRole.status === 200 && revokeRole.body.data.length === 0);
  const staffAfterRevoke = await api("/auth/me", { token: staffToken });
  check("revoking the role removes its permissions", !staffAfterRevoke.body?.data?.permissions?.includes("menus.read"));

  // ---- user listing, suspension, deletion
  const userList = await api(`/admin/users?search=${encodeURIComponent(`e2e-${stamp}`)}&limit=10`, { token: adminToken });
  check("user search finds the e2e accounts", userList.status === 200 && userList.body.data.length >= 3, userList.body?.data?.length);
  check("user list is paginated with meta", typeof userList.body?.meta?.hasMore === "boolean");
  check("password hash never leaves the server", !JSON.stringify(userList.body).includes("passwordHash"));

  const suspend = await api(`/admin/users/${staffId}/status`, { method: "PATCH", token: adminToken, body: { status: "SUSPENDED", reason: "e2e test" } });
  check("user can be suspended", suspend.status === 200 && suspend.body?.data?.status === "SUSPENDED");
  const staffAfterSuspend = await api("/auth/me", { token: staffToken });
  check("suspension kills the live session immediately", staffAfterSuspend.status === 401, staffAfterSuspend.body);
  const suspendedLogin = await api("/auth/login", { method: "POST", body: { email: staffEmail, password: "staff-passphrase-1" } });
  check("a suspended account cannot log in", suspendedLogin.status === 403 && suspendedLogin.body?.error?.details?.reason === "ACCOUNT_SUSPENDED", suspendedLogin.body?.error);

  const reactivate = await api(`/admin/users/${staffId}/status`, { method: "PATCH", token: adminToken, body: { status: "ACTIVE" } });
  check("user can be reactivated", reactivate.status === 200 && reactivate.body?.data?.status === "ACTIVE");
  const reactivatedLogin = await api("/auth/login", { method: "POST", body: { email: staffEmail, password: "staff-passphrase-1" } });
  check("a reactivated account can log in again", reactivatedLogin.status === 200);
  staffToken = reactivatedLogin.body.data.accessToken;

  const selfSuspend = await api(`/admin/users/${adminId}/status`, { method: "PATCH", token: adminToken, body: { status: "SUSPENDED" } });
  check("you cannot suspend yourself", selfSuspend.status === 400, selfSuspend.body?.error);
  const selfDelete = await api(`/admin/users/${adminId}`, { method: "DELETE", token: adminToken });
  check("you cannot delete yourself", selfDelete.status === 400);

  const deleteStaff = await api(`/admin/users/${staffId}`, { method: "DELETE", token: adminToken });
  check("user delete returns 204", deleteStaff.status === 204);
  const deletedLogin = await api("/auth/login", { method: "POST", body: { email: staffEmail, password: "staff-passphrase-1" } });
  check("a deleted user cannot log in", deletedLogin.status === 401);
  const getDeleted = await api(`/admin/users/${staffId}`, { token: adminToken });
  check("a deleted user is not readable", getDeleted.status === 404);

  const roleWithUsers = await api(`/admin/roles/${roleId}`, { method: "DELETE", token: adminToken });
  check("custom role deletes once nobody holds it", roleWithUsers.status === 204, roleWithUsers.body);
  if (roleWithUsers.status === 204) createdRoleIds.delete(roleId);

  // ===================== AUDIT LOG =====================
  await new Promise((r) => setTimeout(r, 1200)); // audit writes run after the response
  const audit = await api(`/admin/audit-logs?limit=50`, { token: adminToken });
  check("audit log is queryable", audit.status === 200 && audit.body.data.length > 0, audit.body?.data?.length);
  check("audit entries carry the actor", audit.body.data.every((row) => row.action && row.entityType));
  const auditFiltered = await api(`/admin/audit-logs?action=user.status_change`, { token: adminToken });
  check("audit filter by action works", auditFiltered.status === 200 && auditFiltered.body.data.every((r) => r.action.startsWith("user.status_change")), auditFiltered.body?.data?.map((r) => r.action));
  const auditByActor = await api(`/admin/audit-logs?actorId=${adminId}`, { token: adminToken });
  check("audit filter by actor works", auditByActor.body.data.every((r) => r.actor?.id === adminId));
  const auditActions = await api("/admin/audit-logs/actions", { token: adminToken });
  check("audit action list is returned", auditActions.status === 200 && auditActions.body.data.includes("user.create"), auditActions.body?.data);
  const auditDenied = await api("/admin/audit-logs", { token: custToken });
  check("audit log is not readable without permission", auditDenied.status === 403);

  // ===================== RATE LIMITING =====================
  const rlEmail = emailOf("ratelimit");
  let sawLimit = false;
  let headersPresent = false;
  // One more than RateLimits.auth (20 per 15 minutes) from a single address.
  for (let i = 0; i < 22; i++) {
    const attempt = await api("/auth/login", { method: "POST", body: { email: rlEmail, password: "nope-nope-nope" }, ip: `203.0.113.${stamp % 200}` });
    if (attempt.headers.get("ratelimit-limit")) headersPresent = true;
    if (attempt.status === 429) { sawLimit = true; break; }
  }
  check("login is rate limited after repeated attempts", sawLimit);
  check("RateLimit headers are sent", headersPresent);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));
}

async function cleanup() {
  const userIds = [...createdUserIds];
  const emailLike = `e2e-${stamp}-`;
  const users = await prisma.user.findMany({ where: { email: { contains: emailLike } }, select: { id: true } });
  const ids = [...new Set([...userIds, ...users.map((u) => u.id)])];

  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: ids } }] } });
  await prisma.credentialToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.address.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userPermissionOverride.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userRoleAssignment.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  // Audited against the role's id, not the actor's, so the user-keyed sweep
  // above leaves it behind and the run reports itself dirty.
  await prisma.auditLog.deleteMany({ where: { entityType: "Role", entityId: { in: [...createdRoleIds] } } });
  await prisma.rolePermission.deleteMany({ where: { roleId: { in: [...createdRoleIds] } } });
  await prisma.role.deleteMany({ where: { OR: [{ id: { in: [...createdRoleIds] } }, { key: { startsWith: "e2e-" } }] } });

  return census();
}

/**
 * What the suite must leave exactly as it found it.
 *
 * Measured rather than assumed: this phase used to assert zero users and
 * twenty roles, which only held on a freshly reset database and turned every
 * run against a working one into a spurious failure. The question worth asking
 * is not "is the database empty" but "did this suite put it back".
 */
async function census() {
  return {
    users: await prisma.user.count(),
    roles: await prisma.role.count(),
    audit: await prisma.auditLog.count(),
    tokens: await prisma.refreshToken.count(),
    addresses: await prisma.address.count(),
    credentialTokens: await prisma.credentialToken.count(),
  };
}

/**
 * What this suite left behind, counted by its own markers.
 *
 * Not a diff of global counts. This database is shared with a running
 * application: the first version of this check compared totals before and
 * after, and duly reported a leak when somebody moved a real order through
 * its statuses while the suite happened to be running. A suite can only be
 * held to the rows it could itself have created, so each count here is
 * keyed to this run's own stamp.
 */
async function ownFootprint() {
  const roleIds = [...createdRoleIds];
  const userIds = [...createdUserIds];
  const emailLike = `e2e-${stamp}-`;

  return {
    users: await prisma.user.count({ where: { email: { contains: emailLike } } }),
    roles: await prisma.role.count({ where: { key: { startsWith: "e2e-" } } }),
    addresses: await prisma.address.count({ where: { userId: { in: userIds } } }),
    tokens: await prisma.refreshToken.count({ where: { userId: { in: userIds } } }),
    credentialTokens: await prisma.credentialToken.count({ where: { userId: { in: userIds } } }),
    audit: await prisma.auditLog.count({
      where: {
        OR: [
          { actorId: { in: userIds } },
          { entityId: { in: userIds } },
          ...(roleIds.length ? [{ entityType: "Role", entityId: { in: roleIds } }] : []),
        ],
      },
    }),
  };
}

assertConsoleMailDriver();

let baseline = null;

try {
  // Wake the database before the first assertion, so a suspended compute
  // fails here rather than as a mystery timeout mid-suite.
  await warmUpDatabase(prisma);
  baseline = await census();
  console.log("Database before:", JSON.stringify(baseline));
  await main();
} catch (error) {
  console.log("SUITE ERROR:", error.message, "\n", error.stack?.split("\n").slice(0, 4).join("\n"));
  failures.push("suite crashed: " + error.message);
} finally {
  const leftovers = await cleanup();
  await prisma.$disconnect();
  console.log("Database after cleanup:", JSON.stringify(leftovers));
  const mine = await ownFootprint().catch(() => null);
  const changes = mine
    ? Object.entries(mine).filter(([, value]) => value > 0).map(([key, value]) => `${key}: ${value}`)
    : ["could not measure what was left behind"];
  const clean = changes.length === 0;
  if (!clean) console.log("WARNING: this suite left rows behind:", changes.join(", "));
  process.exit(failures.length === 0 && clean ? 0 : 1);
}
