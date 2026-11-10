import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions, warmUpDatabase } from "../src/lib/db-pool.js";

const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const CRON_SECRET = process.env.E2E_CRON_SECRET ?? "phase2-test-secret";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });

const stamp = Date.now();
const emailOf = (tag) => `e2e2-${stamp}-${tag}@example.test`;
const BRANCH_CODE = `E2E${String(stamp).slice(-6)}`;
const created = { userIds: new Set(), branchIds: new Set(), assetKeys: new Set(), outboxIds: new Set() };

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { passed++; console.log("PASS ", name); }
  else { failures.push(name); console.log("FAIL ", name, detail !== undefined ? "::" + JSON.stringify(detail).slice(0, 300) : ""); }
}

let ipCounter = 0;
const nextIp = () => `10.${(++ipCounter >> 8) & 255}.${ipCounter & 255}.1`;

async function api(pathname, { method = "GET", body, token, headers = {}, ip, raw, absolute } = {}) {
  const url = absolute ?? `${BASE}/api/v1${pathname}`;
  const res = await fetch(url, {
    method,
    headers: {
      ...(raw ? {} : { "content-type": "application/json" }),
      "x-forwarded-for": ip ?? nextIp(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: raw ? body : JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 120) }; }
  return { status: res.status, body: json, headers: res.headers };
}

/** The branch's local weekday, so hour windows can be built deterministically. */
function localDayOfWeek(timezone) {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(new Date());
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[weekday];
}

async function main() {
  // ---- actors -------------------------------------------------------------
  const custEmail = emailOf("cust");
  const cust = await api("/auth/register", { method: "POST", body: { name: "P2 Customer", email: custEmail, password: "customer-passphrase" } });
  created.userIds.add(cust.body.data.user.id);
  const custToken = cust.body.data.accessToken;
  const custId = cust.body.data.user.id;

  const adminEmail = emailOf("admin");
  const adminReg = await api("/auth/register", { method: "POST", body: { name: "P2 Admin", email: adminEmail, password: "admin-passphrase-2" } });
  const adminId = adminReg.body.data.user.id;
  created.userIds.add(adminId);
  await prisma.user.update({ where: { id: adminId }, data: { isSuperAdmin: true, status: "ACTIVE", emailVerifiedAt: new Date() } });
  const adminLogin = await api("/auth/login", { method: "POST", body: { email: adminEmail, password: "admin-passphrase-2" } });
  const adminToken = adminLogin.body.data.accessToken;

  // ===================== BRANCHES =====================
  const denied = await api("/admin/branches", { method: "POST", token: custToken, body: { code: "NOPE", name: "Nope" } });
  check("a customer cannot create a branch", denied.status === 403, denied.body?.error);

  const badTz = await api("/admin/branches", { method: "POST", token: adminToken, body: { code: `${BRANCH_CODE}X`, name: "Bad TZ", timezone: "Mars/Olympus" } });
  check("an invalid timezone is rejected", badTz.status === 400 && !!badTz.body?.error?.details?.timezone, badTz.body?.error);

  const branch = await api("/admin/branches", {
    method: "POST", token: adminToken,
    body: { code: BRANCH_CODE.toLowerCase(), name: "E2E Downtown", city: "Karachi", timezone: "Asia/Karachi", phone: "+923001112222" },
  });
  check("branch is created", branch.status === 201 && branch.body?.data?.name === "E2E Downtown", branch.body);
  check("branch code is normalised to uppercase", branch.body?.data?.code === BRANCH_CODE, branch.body?.data?.code);
  check("a new branch defaults to PKR", branch.body?.data?.currency === "PKR");
  const branchId = branch.body.data.id;
  created.branchIds.add(branchId);

  const dupe = await api("/admin/branches", { method: "POST", token: adminToken, body: { code: BRANCH_CODE, name: "Clash" } });
  check("duplicate branch code is 409", dupe.status === 409, dupe.body?.error);

  const patched = await api(`/admin/branches/${branchId}`, { method: "PATCH", token: adminToken, body: { deliveryRadiusKm: 7.5 } });
  check("branch update works", patched.status === 200 && Number(patched.body?.data?.deliveryRadiusKm) === 7.5, patched.body?.data);

  const today = localDayOfWeek("Asia/Karachi");
  const badHours = await api(`/admin/branches/${branchId}/hours`, { method: "PUT", token: adminToken, body: { hours: [{ dayOfWeek: today, opensAt: 600, closesAt: 500 }] } });
  check("closing before opening is rejected", badHours.status === 400, badHours.body?.error);

  const hours = await api(`/admin/branches/${branchId}/hours`, {
    method: "PUT", token: adminToken,
    body: { hours: [{ dayOfWeek: today, opensAt: 0, closesAt: 1439 }, { dayOfWeek: (today + 1) % 7, opensAt: 1200, closesAt: 1560 }] },
  });
  check("hours are saved with readable labels", hours.status === 200 && hours.body.data.length === 2 && !!hours.body.data[0].opensAtLabel, hours.body?.data);
  check("an overnight window is flagged", hours.body.data.some((row) => row.overnight === true), hours.body?.data);

  const publicList = await api("/branches");
  check("public branch list needs no auth", publicList.status === 200 && Array.isArray(publicList.body?.data));
  const listed = publicList.body.data.find((row) => row.id === branchId);
  check("the branch reports itself open inside its hours", listed?.openState?.isOpen === true, listed?.openState);
  check("public branch payload omits internal fields", listed && !("taxIdentifier" in listed) && !("isActive" in listed), Object.keys(listed ?? {}));

  const byCode = await api(`/branches/${BRANCH_CODE}`);
  check("a branch is reachable by its code", byCode.status === 200 && byCode.body?.data?.id === branchId);

  const closure = await api(`/admin/branches/${branchId}/closures`, {
    method: "POST", token: adminToken,
    body: { startsAt: new Date(Date.now() - 3600_000).toISOString(), endsAt: new Date(Date.now() + 3600_000).toISOString(), reason: "E2E maintenance" },
  });
  check("a closure can be created", closure.status === 201, closure.body);
  const duringClosure = await api(`/branches/${branchId}`);
  check("a closure closes the branch", duringClosure.body?.data?.openState?.isOpen === false && duringClosure.body?.data?.openState?.reason === "CLOSURE", duringClosure.body?.data?.openState);
  check("the closure reason is surfaced", duringClosure.body?.data?.openState?.closureReason === "E2E maintenance");

  const badClosure = await api(`/admin/branches/${branchId}/closures`, {
    method: "POST", token: adminToken,
    body: { startsAt: new Date(Date.now() + 3600_000).toISOString(), endsAt: new Date(Date.now() - 3600_000).toISOString() },
  });
  check("a closure ending before it starts is rejected", badClosure.status === 400);

  const removeClosure = await api(`/admin/branches/${branchId}/closures/${closure.body.data.id}`, { method: "DELETE", token: adminToken });
  check("a closure can be removed", removeClosure.status === 204);
  const afterClosure = await api(`/branches/${branchId}`);
  check("removing the closure reopens the branch", afterClosure.body?.data?.openState?.isOpen === true);

  await api(`/admin/branches/${branchId}/hours`, { method: "PUT", token: adminToken, body: { hours: [{ dayOfWeek: (today + 3) % 7, opensAt: 600, closesAt: 1200 }] } });
  const closedNow = await api(`/branches/${branchId}`);
  check("outside its hours the branch is closed", closedNow.body?.data?.openState?.isOpen === false && closedNow.body?.data?.openState?.reason === "OUTSIDE_HOURS", closedNow.body?.data?.openState);
  check("a next opening time is offered", !!closedNow.body?.data?.openState?.nextOpenAt);

  // ===================== SETTINGS =====================
  const publicSettings = await api("/settings/public");
  check("public settings need no auth", publicSettings.status === 200 && publicSettings.body?.data?.["store.name"] === "FoodZone", publicSettings.body?.data);
  check("private settings never appear in the public set", !("notifications.order_updates" in publicSettings.body.data), Object.keys(publicSettings.body.data));

  const settingsDenied = await api("/admin/settings", { token: custToken });
  check("a customer cannot read admin settings", settingsDenied.status === 403);

  const described = await api("/admin/settings", { token: adminToken });
  check("settings are described with their source", described.status === 200 && described.body.data.settings.every((s) => ["DEFAULT", "GLOBAL", "BRANCH"].includes(s.source)));
  check("an untouched setting reads as DEFAULT", described.body.data.settings.find((s) => s.key === "ordering.delivery_fee")?.source === "DEFAULT");

  const unknownKey = await api("/admin/settings", { method: "PUT", token: adminToken, body: { values: { "not.a.setting": 1 } } });
  check("an unknown setting key is rejected", unknownKey.status === 400 && !!unknownKey.body?.error?.details?.["not.a.setting"], unknownKey.body?.error);

  const badType = await api("/admin/settings", { method: "PUT", token: adminToken, body: { values: { "ordering.delivery_fee": "free" } } });
  check("a wrongly typed setting is rejected", badType.status === 400 && !!badType.body?.error?.details?.["ordering.delivery_fee"], badType.body?.error);

  const outOfRange = await api("/admin/settings", { method: "PUT", token: adminToken, body: { values: { "ordering.service_charge_percent": 150 } } });
  check("a setting outside its range is rejected", outOfRange.status === 400);

  const savedGlobal = await api("/admin/settings", { method: "PUT", token: adminToken, body: { values: { "ordering.delivery_fee": 150, "store.name": "E2E Foods" } } });
  check("global settings save", savedGlobal.status === 200 && savedGlobal.body.data.settings.find((s) => s.key === "ordering.delivery_fee")?.value === 150, savedGlobal.body?.error);
  check("a saved setting reads as GLOBAL", savedGlobal.body.data.settings.find((s) => s.key === "store.name")?.source === "GLOBAL");

  const publicAfter = await api("/settings/public");
  check("public settings reflect the change", publicAfter.body?.data?.["store.name"] === "E2E Foods" && publicAfter.body?.data?.["ordering.delivery_fee"] === 150, publicAfter.body?.data);

  const branchOverride = await api("/admin/settings", { method: "PUT", token: adminToken, body: { branchId, values: { "ordering.delivery_fee": 250 } } });
  check("a branch can override an overridable setting", branchOverride.status === 200 && branchOverride.body.data.settings.find((s) => s.key === "ordering.delivery_fee")?.source === "BRANCH");
  check("the branch value wins over the global one", branchOverride.body.data.settings.find((s) => s.key === "ordering.delivery_fee")?.value === 250);

  const notOverridable = await api("/admin/settings", { method: "PUT", token: adminToken, body: { branchId, values: { "store.name": "Branch Name" } } });
  check("a non-overridable setting is refused per branch", notOverridable.status === 400 && !!notOverridable.body?.error?.details?.["store.name"], notOverridable.body?.error);

  const branchPublic = await api(`/settings/public?branchId=${branchId}`);
  check("public settings resolve per branch", branchPublic.body?.data?.["ordering.delivery_fee"] === 250, branchPublic.body?.data);
  const globalPublic = await api("/settings/public");
  check("the global value is untouched by the override", globalPublic.body?.data?.["ordering.delivery_fee"] === 150);

  const resetBranch = await api(`/admin/settings/ordering.delivery_fee?branchId=${branchId}`, { method: "DELETE", token: adminToken });
  check("resetting an override falls back to global", resetBranch.status === 200 && resetBranch.body.data.settings.find((s) => s.key === "ordering.delivery_fee")?.value === 150, resetBranch.body?.error);
  const resetMissing = await api("/admin/settings/maintenance.enabled", { method: "DELETE", token: adminToken });
  check("resetting a setting that is not overridden is 404", resetMissing.status === 404);

  // ===================== MEDIA =====================
  const uploadDenied = await api("/media/uploads", { method: "POST", token: custToken, body: { mimeType: "image/png", sizeBytes: 1000 } });
  check("a customer cannot request an upload", uploadDenied.status === 403, uploadDenied.body?.error);

  const badMime = await api("/media/uploads", { method: "POST", token: adminToken, body: { mimeType: "application/x-msdownload", sizeBytes: 1000 } });
  check("an unsupported file type is rejected", badMime.status === 400 && !!badMime.body?.error?.details?.mimeType);

  const tooBig = await api("/media/uploads", { method: "POST", token: adminToken, body: { mimeType: "image/png", sizeBytes: 50 * 1024 * 1024 } });
  check("an oversized image request is rejected", tooBig.status === 400 && !!tooBig.body?.error?.details?.sizeBytes, tooBig.body?.error);

  // A tiny but real PNG.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const ticketRes = await api("/media/uploads", { method: "POST", token: adminToken, body: { mimeType: "image/png", sizeBytes: png.byteLength, ownerType: "Branch", ownerId: branchId } });
  check("an upload ticket is issued", ticketRes.status === 201 && !!ticketRes.body?.data?.ticket, ticketRes.body);
  check("the ticket carries compression directives", ticketRes.body?.data?.policy?.compression?.required === true && ticketRes.body?.data?.policy?.compression?.maxWidth > 0, ticketRes.body?.data?.policy);
  check("the upload target is provider-shaped", !!ticketRes.body?.data?.upload?.method && !!ticketRes.body?.data?.upload?.url, ticketRes.body?.data?.upload);
  check("the storage key is namespaced by owner", /^branch\/\d{4}\/\d{2}\//.test(ticketRes.body?.data?.storageKey ?? ""), ticketRes.body?.data?.storageKey);
  const { ticket, storageKey, upload } = ticketRes.body.data;
  created.assetKeys.add(storageKey);

  const confirmEarly = await api("/media/uploads/confirm", { method: "POST", token: adminToken, body: { ticket } });
  check("confirming before uploading is rejected", confirmEarly.status === 400, confirmEarly.body?.error);

  const put = await api(null, { method: "PUT", absolute: `${BASE}${upload.url}`, raw: true, body: png, headers: { "content-type": "image/png" } });
  check("the file uploads to the signed target", put.status === 200 && put.body?.data?.stored === true, put.body);

  const confirmed = await api("/media/uploads/confirm", { method: "POST", token: adminToken, body: { ticket } });
  check("confirm records the asset", confirmed.status === 201 && confirmed.body?.data?.sizeBytes === png.byteLength, confirmed.body);
  check("the asset keeps its owner link", confirmed.body?.data?.ownerType === "Branch" && confirmed.body?.data?.ownerId === branchId);
  const assetId = confirmed.body.data.id;

  const confirmAgain = await api("/media/uploads/confirm", { method: "POST", token: adminToken, body: { ticket } });
  check("confirming twice is idempotent", confirmAgain.status === 201 && confirmAgain.body?.data?.id === assetId);

  const fileRes = await fetch(confirmed.body.data.url);
  check("the stored file is served publicly", fileRes.status === 200 && fileRes.headers.get("content-type") === "image/png", fileRes.status);
  check("served files are cached immutably", (fileRes.headers.get("cache-control") ?? "").includes("immutable"));

  const stolenTicket = await api("/media/uploads/confirm", { method: "POST", token: custToken, body: { ticket } });
  check("another user cannot confirm your ticket", [403, 404].includes(stolenTicket.status), stolenTicket.body?.error);

  const badTicket = await api("/media/uploads/confirm", { method: "POST", token: adminToken, body: { ticket: "not.a.valid.ticket.at.all" } });
  check("a forged ticket is rejected", badTicket.status === 400);

  const listed2 = await api(`/media?ownerType=Branch&ownerId=${branchId}`, { token: adminToken });
  check("assets can be listed by owner", listed2.status === 200 && listed2.body.data.some((a) => a.id === assetId));

  const removed = await api(`/media/${assetId}`, { method: "DELETE", token: adminToken });
  check("an asset can be deleted", removed.status === 204);
  const goneRes = await fetch(confirmed.body.data.url);
  check("deleting the asset removes the file too", goneRes.status === 404, goneRes.status);

  // ===================== ORPHANED UPLOAD SWEEP =====================
  //
  // The case the sweep exists for cannot be reached through the API: a client
  // asks for a ticket, sends the bytes and never confirms, so there is a file
  // in storage and no row anywhere that mentions it. Nothing will ever read it
  // and nothing will ever delete it.
  //
  // This runs against the local driver, so the test can age a file on disk and
  // watch the window work. The rules themselves are unit-tested; what is being
  // proved here is that the driver really lists what it stored, that the
  // database lookup matches keys correctly, and above all that the sweep takes
  // the abandoned file and *only* the abandoned file.
  const uploadRoot = path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? "./storage/uploads");
  const isLocalDriver = (process.env.STORAGE_DRIVER ?? "local") === "local";

  if (!isLocalDriver) {
    console.log("SKIP  orphaned upload sweep (driver is not local)");
  } else {
    async function uploadOne({ confirm }) {
      const ticketed = await api("/media/uploads", {
        method: "POST",
        token: adminToken,
        body: { mimeType: "image/png", sizeBytes: png.byteLength, ownerType: "Branch", ownerId: branchId },
      });
      const issued = ticketed.body.data;
      await api(null, { method: "PUT", absolute: `${BASE}${issued.upload.url}`, raw: true, body: png, headers: { "content-type": "image/png" } });
      if (confirm) await api("/media/uploads/confirm", { method: "POST", token: adminToken, body: { ticket: issued.ticket } });
      created.assetKeys.add(issued.storageKey);
      return issued.storageKey;
    }

    const orphanKey = await uploadOne({ confirm: false });
    const confirmedKey = await uploadOne({ confirm: true });
    const recentKey = await uploadOne({ confirm: false });

    // A file nothing in this system wrote. It is the one the sweep must never
    // touch however old it is — a bucket is shared, and deleting somebody
    // else's export is not housekeeping.
    const foreignPath = path.join(uploadRoot, `e2e2-${stamp}-not-ours.txt`);
    fs.writeFileSync(foreignPath, "belongs to somebody else");
    const ancient = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    fs.utimesSync(foreignPath, ancient, ancient);

    // Age the two unconfirmed uploads past the window; the "recent" one stays
    // where it is, standing in for an upload that is still in flight.
    const aged = new Date(Date.now() - 6 * 60 * 60 * 1000);
    for (const key of [orphanKey, confirmedKey]) {
      fs.utimesSync(path.join(uploadRoot, key), aged, aged);
    }

    const onDisk = (key) => fs.existsSync(path.join(uploadRoot, key));

    const dry = await api("/admin/media/sweep", { method: "POST", token: adminToken });
    check("a dry run reports the abandoned upload", dry.status === 200 && dry.body?.data?.removed?.includes(orphanKey), dry.body?.data);
    check("a dry run names the keys rather than counting them", Array.isArray(dry.body?.data?.removed), dry.body?.data?.removed);
    check("a dry run deletes nothing", onDisk(orphanKey), { orphanKey });
    check("a dry run says so in its own result", dry.body?.data?.dryRun === true, dry.body?.data);

    const denied = await api("/admin/media/sweep?dryRun=false", { method: "POST", token: custToken });
    check("a customer cannot sweep the bucket", denied.status === 403, denied.body?.error);

    const live = await api("/admin/media/sweep?dryRun=false", { method: "POST", token: adminToken });
    check("a live sweep runs", live.status === 200 && live.body?.data?.dryRun === false, live.body?.data);
    // `dryRun=false` is the string "false": `z.coerce.boolean()` would have
    // made that truthy and quietly performed a dry run instead.
    check("the sweep takes the abandoned upload", !onDisk(orphanKey), { orphanKey });
    check("a confirmed upload is left alone", onDisk(confirmedKey), { confirmedKey });
    check("an upload still inside its window is left alone", onDisk(recentKey), { recentKey });
    check("a file this system did not write is left alone", fs.existsSync(foreignPath), { foreignPath });
    check("the foreign file is reported as ignored, not swept", live.body?.data?.counts?.ignored >= 1, live.body?.data?.counts);
    check("the bytes freed are reported", live.body?.data?.bytes >= png.byteLength, live.body?.data);

    const second = await api("/admin/media/sweep?dryRun=false", { method: "POST", token: adminToken });
    check("a second sweep finds nothing left to take", second.body?.data?.deleted === 0, second.body?.data);

    fs.rmSync(foreignPath, { force: true });
    for (const key of [confirmedKey, recentKey]) fs.rmSync(path.join(uploadRoot, key), { force: true });
  }

  // ===================== NOTIFICATIONS =====================
  const sendDenied = await api("/admin/notifications", { method: "POST", token: custToken, body: { userIds: [custId], title: "Nope" } });
  check("a customer cannot send notifications", sendDenied.status === 403);

  const sent = await api("/admin/notifications", { method: "POST", token: adminToken, body: { userIds: [custId], type: "admin.message", title: "Your order is ready", body: "Come and collect it" } });
  check("a notification is sent to named users", sent.status === 201 && sent.body?.data?.created === 1, sent.body);

  const feed = await api("/me/notifications", { token: custToken });
  check("the recipient sees it in their feed", feed.status === 200 && feed.body.data.length === 1 && feed.body.data[0].title === "Your order is ready", feed.body?.data);
  const unread = await api("/me/notifications/unread-count", { token: custToken });
  check("the unread count is right", unread.body?.data?.unread === 1, unread.body?.data);

  const byRole = await api("/admin/notifications", { method: "POST", token: adminToken, body: { roleKey: "customer", title: "Everyone gets this" } });
  check("a notification can target a whole role", byRole.status === 201 && byRole.body?.data?.created >= 1, byRole.body);

  const unreadOnly = await api("/me/notifications?unreadOnly=true", { token: custToken });
  check("the feed can be filtered to unread", unreadOnly.body.data.length === 2, unreadOnly.body?.data?.length);

  const readOne = await api("/me/notifications/read", { method: "POST", token: custToken, body: { ids: [feed.body.data[0].id] } });
  check("one notification can be marked read", readOne.body?.data?.marked === 1 && readOne.body?.data?.unread === 1, readOne.body?.data);

  const readAll = await api("/me/notifications/read", { method: "POST", token: custToken, body: {} });
  check("the whole feed can be marked read", readAll.body?.data?.unread === 0, readAll.body?.data);

  const otherFeed = await api("/me/notifications", { token: adminToken });
  check("a feed only shows your own notifications", otherFeed.body.data.every((n) => n.title !== "Your order is ready"), otherFeed.body?.data?.length);

  const deleted = await api(`/me/notifications/${feed.body.data[0].id}`, { method: "DELETE", token: custToken });
  check("a notification can be dismissed", deleted.status === 204);

  // ===================== SHARED RATE LIMIT STORE =====================
  /*
   * The limiter's default store is an in-process map, which is correct for one
   * instance and silently wrong for two: each allows the full quota, so a cap
   * of 20 login attempts becomes 40 and nothing anywhere reports it. This
   * server runs with `RATE_LIMIT_STORE=postgres`, and what follows proves the
   * counters are genuinely shared rather than quietly falling back.
   *
   * Driven through `/auth/login` with a wrong password from one fixed IP: it is
   * keyed by IP for anonymous callers, and `RateLimits.auth` is the tightest
   * cap in the system at 20 per fifteen minutes.
   */
  const limitIp = `10.99.${(stamp >> 8) & 255}.${stamp & 255}`;
  const knock = () =>
    api("/auth/login", {
      method: "POST",
      ip: limitIp,
      body: { email: emailOf("nobody"), password: "wrong-passphrase-entirely" },
    });

  await knock();

  // The scope is the route's own (`scope: "auth:login"`), not the name of the
  // limit preset it uses — so the key is the scope plus the caller's identity.
  const counterKey = `auth:login:ip:${limitIp}`;
  const firstRow = await prisma.rateLimitCounter.findUnique({ where: { key: counterKey } });
  check("a counted request writes a shared counter", Boolean(firstRow), { counterKey, firstRow });
  check("keyed by scope and identity, so two scopes do not share a quota", firstRow?.key === counterKey, firstRow?.key);
  check("with a window end in the future", firstRow && new Date(firstRow.resetAt) > new Date(), firstRow?.resetAt);

  await knock();
  const secondRow = await prisma.rateLimitCounter.findUnique({ where: { key: counterKey } });
  check("a second request increments the same row rather than adding one", secondRow?.count === 2, secondRow);
  check(
    "and does not move the window, so the quota cannot be extended by using it",
    secondRow && new Date(secondRow.resetAt).getTime() === new Date(firstRow.resetAt).getTime(),
    { first: firstRow?.resetAt, second: secondRow?.resetAt },
  );

  // Past the cap. 20 is the `auth` limit; a few extra to be sure of crossing it.
  let sawLimit = false;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const result = await knock();
    if (result.status === 429) {
      sawLimit = true;
      break;
    }
  }
  check("the shared counter refuses once the quota is spent", sawLimit);

  /*
   * The local shed, observed from the outside.
   *
   * A limiter has to be cheap exactly when it is working hardest — backed only
   * by the database, a brute-force becomes a write storm on the same database
   * serving orders. Once the shared store has refused a key, this process
   * answers the rest of that window from memory.
   *
   * Which is visible here: the stored count stops rising even though the
   * requests keep coming and keep being refused. If it kept climbing, every
   * request in a flood would still be a write.
   */
  const atRefusal = await prisma.rateLimitCounter.findUnique({ where: { key: counterKey } });
  // Guarded, because the interesting assertion below compares two counts and
  // would pass on a pair of undefineds if the key were ever wrong again.
  check("the counter is there to compare against", (atRefusal?.count ?? 0) > 0, atRefusal);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await knock();
    check(`request ${attempt + 1} past the cap is still refused`, result.status === 429, result.status);
  }
  const afterFlood = await prisma.rateLimitCounter.findUnique({ where: { key: counterKey } });
  check(
    "a flood past the cap is shed in-process rather than written to the database",
    Boolean(atRefusal) && afterFlood?.count === atRefusal.count,
    { atRefusal: atRefusal?.count, afterFlood: afterFlood?.count },
  );

  /*
   * A shed refusal still has to carry the same headers as one the database
   * produced. The whole point of answering from memory is that the caller
   * cannot tell — and `Retry-After` is the one header a client throttling
   * itself actually needs.
   */
  const refusedAgain = await knock();
  check("a shed refusal is still a 429", refusedAgain.status === 429, refusedAgain.status);
  check(
    "and still says when to come back",
    Number(refusedAgain.headers.get("retry-after")) > 0,
    refusedAgain.headers.get("retry-after"),
  );
  check(
    "and still carries the reading, from memory as from the database",
    refusedAgain.headers.get("ratelimit-limit") === "20" && refusedAgain.headers.get("ratelimit-remaining") === "0",
    {
      limit: refusedAgain.headers.get("ratelimit-limit"),
      remaining: refusedAgain.headers.get("ratelimit-remaining"),
    },
  );

  // A different identity is unaffected: the key is the scope plus the caller,
  // so one address exhausting its quota must not lock out everybody else.
  const otherIp = `10.98.${(stamp >> 8) & 255}.${stamp & 255}`;
  const otherCaller = await api("/auth/login", {
    method: "POST",
    ip: otherIp,
    body: { email: emailOf("nobody"), password: "wrong-passphrase-entirely" },
  });
  check("another caller has their own quota", otherCaller.status !== 429, otherCaller.status);

  /*
   * The prune. Housekeeping rather than correctness — nothing reads an expired
   * row, because the upsert resets a finished window in place — but on a public
   * endpoint keyed by IP it is a row per address per window, so it does have to
   * happen.
   */
  await prisma.rateLimitCounter.create({
    data: { key: `stale:${stamp}`, count: 99, resetAt: new Date(Date.now() - 48 * 3_600_000) },
  });
  const pruneRun = await fetch(`${BASE}/api/internal/jobs/maintenance`, {
    method: "POST",
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  const maintained = pruneRun.ok ? (await pruneRun.json().catch(() => null))?.data : null;
  check("the maintenance job reports on counters pruned", typeof maintained?.rateLimitsPruned?.pruned === "number", maintained?.rateLimitsPruned);

  const stale = await prisma.rateLimitCounter.findUnique({ where: { key: `stale:${stamp}` } });
  check("a counter whose window ended a day ago is pruned", stale === null, stale);

  const live = await prisma.rateLimitCounter.findUnique({ where: { key: counterKey } });
  check("while a live counter is left alone", Boolean(live), live);

  /*
   * Three behaviours of the store itself, which no request can reach.
   *
   * Rolling a window over means backdating a row and asking again; shedding
   * means proving a call did *not* reach the database. Both are invisible from
   * the outside, and the first is where the real bug was: `resetAt` is a
   * `timestamp without time zone` holding UTC, `now()` is a `timestamptz`, and
   * comparing them makes Postgres reinterpret the column in the session's zone.
   * This database runs in the branch's zone, so every window read as five
   * hours older than it was — every counter reset to 1 on every request, and
   * the limiter counted to one forever while reporting success. It would have
   * passed on a UTC machine.
   */
  const { postgresRateLimitStore, pruneRateLimitCounters } = await import("@/lib/api/rate-limit-store");
  const store = postgresRateLimitStore();
  const storeKey = `unit:${stamp}`;

  const firstHit = await store.increment(storeKey, 60_000);
  const secondHit = await store.increment(storeKey, 60_000);
  check("the shared store counts up", firstHit.count === 1 && secondHit.count === 2, { firstHit, secondHit });
  check(
    "and holds the window, so a caller cannot extend their quota by spending it",
    firstHit.resetAt === secondHit.resetAt,
    { firstHit, secondHit },
  );

  await prisma.rateLimitCounter.update({ where: { key: storeKey }, data: { resetAt: new Date(Date.now() - 1_000) } });
  const rolled = await store.increment(storeKey, 60_000);
  check("a window that has ended starts again at one", rolled.count === 1, rolled);
  check("with a new end, in the same statement that counted", rolled.resetAt > secondHit.resetAt, { secondHit, rolled });

  store.remember(storeKey, Date.now() + 60_000);
  const beforeShed = await prisma.rateLimitCounter.findUnique({ where: { key: storeKey } });
  const shedHit = await store.increment(storeKey, 60_000);
  const afterShed = await prisma.rateLimitCounter.findUnique({ where: { key: storeKey } });
  check("a remembered refusal is answered from memory", shedHit.shed === true, shedHit);
  check("without a database write", beforeShed.count === afterShed.count, { beforeShed: beforeShed.count, afterShed: afterShed.count });

  await store.reset(storeKey);
  check("a reset clears the row", (await prisma.rateLimitCounter.findUnique({ where: { key: storeKey } })) === null);
  const afterReset = await store.increment(storeKey, 60_000);
  check("and the local shed with it, so a successful login is not still refused", afterReset.count === 1 && !afterReset.shed, afterReset);

  await prisma.rateLimitCounter.create({
    data: { key: `unit-stale:${stamp}`, count: 9, resetAt: new Date(Date.now() - 48 * 3_600_000) },
  });
  const prunedDirect = await pruneRateLimitCounters();
  check("pruning removes a finished window", prunedDirect.pruned >= 1, prunedDirect);
  check("and leaves a live one", Boolean(await prisma.rateLimitCounter.findUnique({ where: { key: storeKey } })));
  await prisma.rateLimitCounter.deleteMany({ where: { key: { contains: String(stamp) } } });

  // ===================== NOTIFICATION PREFERENCES =====================
  /*
   * The rule being defended: **the in-app row is the record, the push is the
   * interruption.** Somebody may stop their phone going off about an order;
   * they may not make the cancellation of one leave no trace, because an order
   * that vanished without a record is a support call nobody can answer.
   *
   * Marketing is the exception that makes the distinction worth having — an
   * offer records nothing, so opting out of it silences it completely.
   */
  const prefs = await api("/me/notification-preferences", { token: custToken });
  check("preferences list every category, not only the ones touched", prefs.status === 200 && prefs.body.data.length >= 5, prefs.body?.data?.length);

  const orderPref = prefs.body.data.find((row) => row.key === "order");
  check("order updates are on by default", orderPref?.inApp === true && orderPref?.push === true, orderPref);
  check(
    "and the screen is told their record cannot be silenced",
    orderPref?.canMuteInApp === false,
    orderPref,
  );

  const marketingPref = prefs.body.data.find((row) => row.key === "marketing");
  check("marketing is off until somebody opts in", marketingPref?.inApp === false && marketingPref?.push === false, marketingPref);
  check("and is the one category that can be silenced outright", marketingPref?.canMuteInApp === true, marketingPref);

  // Staff categories are not offered to a customer who could never receive one.
  check(
    "a customer is not offered the staff category",
    !prefs.body.data.some((row) => row.audience === "staff"),
    prefs.body.data.map((row) => row.key),
  );

  const muteRecord = await api("/me/notification-preferences", {
    method: "PUT",
    token: custToken,
    body: { categories: { order: { inApp: false } } },
  });
  check(
    "switching off the record of a transactional category is refused",
    muteRecord.status === 400,
    { status: muteRecord.status, body: muteRecord.body?.error },
  );
  check(
    "and refused in words that say what to do instead",
    /alerts/i.test(JSON.stringify(muteRecord.body?.error?.details ?? {})),
    muteRecord.body?.error?.details,
  );

  const mutePush = await api("/me/notification-preferences", {
    method: "PUT",
    token: custToken,
    body: { categories: { order: { push: false } } },
  });
  check("but switching off the alert is allowed", mutePush.status === 200, mutePush.body?.error);
  check(
    "and leaves the record on",
    mutePush.body?.data?.find((row) => row.key === "order")?.inApp === true,
    mutePush.body?.data?.find((row) => row.key === "order"),
  );

  // Only the named category moves. A screen that shows a subset must not wipe
  // what it does not know about.
  check(
    "saving one category leaves the others alone",
    mutePush.body?.data?.find((row) => row.key === "payment")?.push === true,
    mutePush.body?.data?.find((row) => row.key === "payment"),
  );

  const invented = await api("/me/notification-preferences", {
    method: "PUT",
    token: custToken,
    body: { categories: { "not-a-category": { push: false } } },
  });
  check("a category cannot be invented by posting a string", invented.status === 400, invented.status);

  const nothing = await api("/me/notification-preferences", { method: "PUT", token: custToken, body: { categories: {} } });
  check("and saving nothing is an error rather than a no-op", nothing.status === 400, nothing.status);

  /*
   * Marketing suppressed end to end: an opted-out person gets no row at all,
   * which is the only category where that is true. Sent through the admin
   * endpoint so it travels the same path a real campaign would.
   */
  const campaign = await api("/admin/notifications", {
    method: "POST",
    token: adminToken,
    body: { userIds: [custId], type: "marketing.campaign", title: "Two for one Tuesdays" },
  });
  check("a marketing send to an opted-out person creates nothing", campaign.body?.data?.created === 0, campaign.body?.data);
  check("and says how many it suppressed rather than reporting success", campaign.body?.data?.suppressed === 1, campaign.body?.data);

  const optIn = await api("/me/notification-preferences", {
    method: "PUT",
    token: custToken,
    body: { categories: { marketing: { inApp: true, push: true } } },
  });
  check("opting in is a single switch", optIn.status === 200, optIn.body?.error);

  const campaignAgain = await api("/admin/notifications", {
    method: "POST",
    token: adminToken,
    body: { userIds: [custId], type: "marketing.campaign", title: "Two for one Tuesdays" },
  });
  check("after which the same campaign lands", campaignAgain.body?.data?.created === 1, campaignAgain.body?.data);

  /*
   * A type no category claims is delivered. An unclassified notification is a
   * gap in the registry, and the right behaviour for a gap is to deliver and
   * let somebody notice it on a screen — silence is the one failure nobody
   * reports. `admin.message` above is exactly that case and arrived.
   */
  const unclassified = await api("/admin/notifications", {
    method: "POST",
    token: adminToken,
    body: { userIds: [custId], type: "nothing.claims_this", title: "Still gets through" },
  });
  check("a type no category claims is still delivered", unclassified.body?.data?.created === 1, unclassified.body?.data);

  const prefsDenied = await api("/me/notification-preferences", { token: null });
  check("preferences need a session", prefsDenied.status === 401, prefsDenied.status);

  // ===================== DEVICES =====================
  const badToken = await api("/me/devices", { method: "POST", token: custToken, body: { pushToken: "fcm-style-token", platform: "ANDROID" } });
  check("a non-Expo push token is rejected", badToken.status === 400 && !!badToken.body?.error?.details?.pushToken, badToken.body?.error);

  const expoToken = `ExponentPushToken[e2e-${stamp}]`;
  const device = await api("/me/devices", { method: "POST", token: custToken, body: { pushToken: expoToken, platform: "IOS", deviceName: "E2E iPhone" } });
  check("a device registers", device.status === 201 && device.body?.data?.platform === "IOS", device.body);

  const devices = await api("/me/devices", { token: custToken });
  check("devices are listed", devices.status === 200 && devices.body.data.length === 1);
  check("the push token is never returned", !JSON.stringify(devices.body).includes(expoToken), devices.body?.data);

  const reRegister = await api("/me/devices", { method: "POST", token: custToken, body: { pushToken: expoToken, platform: "IOS", deviceName: "Renamed" } });
  check("re-registering the same token does not duplicate", reRegister.status === 201);
  const devicesAfter = await api("/me/devices", { token: custToken });
  check("the device list still has one entry", devicesAfter.body.data.length === 1, devicesAfter.body?.data?.length);
  check("re-registering updates the details", devicesAfter.body.data[0].deviceName === "Renamed");

  const handover = await api("/me/devices", { method: "POST", token: adminToken, body: { pushToken: expoToken, platform: "IOS", deviceName: "Now the admin's" } });
  check("a token moves to whoever registers it last", handover.status === 201);
  const custDevices = await api("/me/devices", { token: custToken });
  check("the previous owner no longer has it", custDevices.body.data.length === 0, custDevices.body?.data);

  const removeDevice = await api(`/me/devices/${handover.body.data.id}`, { method: "DELETE", token: adminToken });
  check("a device can be removed", removeDevice.status === 204);

  // ===================== OUTBOX WORKER =====================
  const noSecret = await api(null, { absolute: `${BASE}/api/internal/jobs/outbox`, method: "POST" });
  check("the internal job endpoint is hidden without the secret", noSecret.status === 404, noSecret.status);
  const wrongSecret = await api(null, { absolute: `${BASE}/api/internal/jobs/outbox`, method: "POST", token: "wrong-secret" });
  check("a wrong secret is refused", wrongSecret.status === 404);

  const emailEvent = await prisma.outboxEvent.create({
    data: { eventType: "notification.email", payload: { to: emailOf("outbox"), subject: "E2E outbox", text: "delivered by the worker" } },
  });
  const unknownEvent = await prisma.outboxEvent.create({ data: { eventType: "does.not.exist", payload: {} } });
  const futureEvent = await prisma.outboxEvent.create({
    data: { eventType: "notification.email", payload: { to: emailOf("later"), subject: "later", text: "not yet" }, availableAt: new Date(Date.now() + 3600_000) },
  });
  [emailEvent, unknownEvent, futureEvent].forEach((event) => created.outboxIds.add(event.id));

  const drained = await api(null, { absolute: `${BASE}/api/internal/jobs/outbox`, method: "POST", token: CRON_SECRET });
  check("the worker runs with the right secret", drained.status === 200, drained.body?.error);
  check("a due event is processed", drained.body?.data?.processed >= 1, drained.body?.data);
  check("an event with no handler fails permanently", drained.body?.data?.failed >= 1, drained.body?.data);
  check("the response reports queue stats", Array.isArray(drained.body?.data?.stats?.handlers) && drained.body.data.stats.handlers.includes("notification.push"), drained.body?.data?.stats);

  const rows = await prisma.outboxEvent.findMany({ where: { id: { in: [emailEvent.id, unknownEvent.id, futureEvent.id] } } });
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  check("the delivered event is marked DONE", byId[emailEvent.id]?.status === "DONE" && !!byId[emailEvent.id]?.processedAt, byId[emailEvent.id]?.status);
  check("the unhandled event is marked FAILED with a reason", byId[unknownEvent.id]?.status === "FAILED" && !!byId[unknownEvent.id]?.lastError, byId[unknownEvent.id]);
  check("an event scheduled for later is left alone", byId[futureEvent.id]?.status === "PENDING", byId[futureEvent.id]?.status);

  const drainAgain = await api(null, { absolute: `${BASE}/api/internal/jobs/outbox`, method: "POST", token: CRON_SECRET });
  check("a second run does not reprocess completed events", drainAgain.body?.data?.processed === 0, drainAgain.body?.data);

  const maintenance = await api(null, { absolute: `${BASE}/api/internal/jobs/maintenance`, method: "POST", token: CRON_SECRET });
  check("the maintenance job runs", maintenance.status === 200 && typeof maintenance.body?.data?.pruned === "number", maintenance.body);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));
}

async function cleanup() {
  const emailLike = `e2e2-${stamp}-`;
  const users = await prisma.user.findMany({ where: { email: { contains: emailLike } }, select: { id: true } });
  const ids = [...new Set([...created.userIds, ...users.map((u) => u.id)])];

  await prisma.outboxEvent.deleteMany({ where: { OR: [{ id: { in: [...created.outboxIds] } }, { eventType: "does.not.exist" }] } });
  await prisma.userDevice.deleteMany({ where: { userId: { in: ids } } });
  await prisma.rateLimitCounter.deleteMany({ where: { OR: [{ key: { contains: String(stamp) } }, { key: { startsWith: "auth:login:ip:10.9" } }] } });
  await prisma.notificationPreference.deleteMany({ where: { userId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.mediaAsset.deleteMany({ where: { OR: [{ uploadedById: { in: ids } }, { storageKey: { in: [...created.assetKeys] } }] } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: [...created.branchIds] } }] } });
  await prisma.credentialToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userRoleAssignment.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  // Cascades to hours, closures and branch-scoped settings.
  await prisma.branch.deleteMany({ where: { code: { startsWith: "E2E" } } });
  await prisma.setting.deleteMany({});

  for (const key of created.assetKeys) {
    const file = path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? "./storage/uploads", key);
    try { fs.unlinkSync(file); } catch { /* already gone */ }
  }

  const leftovers = {
    users: await prisma.user.count(),
    branches: await prisma.branch.count(),
    settings: await prisma.setting.count(),
    media: await prisma.mediaAsset.count(),
    notifications: await prisma.notification.count(),
    devices: await prisma.userDevice.count(),
    outbox: await prisma.outboxEvent.count(),
    roles: await prisma.role.count(),
  };
  console.log("\nDatabase after cleanup:", JSON.stringify(leftovers));
  return leftovers;
}

try {
  // Wake the database before the first assertion, so a suspended compute
  // fails here rather than as a mystery timeout mid-suite.
  await warmUpDatabase(prisma);
  await main();
} catch (error) {
  console.log("SUITE ERROR:", error.message, "\n", error.stack?.split("\n").slice(0, 4).join("\n"));
  failures.push("suite crashed: " + error.message);
} finally {
  const leftovers = await cleanup();
  await prisma.$disconnect();
  const clean = leftovers.users === 0 && leftovers.branches === 0 && leftovers.settings === 0 && leftovers.media === 0 && leftovers.outbox === 0 && leftovers.roles === 20;
  if (!clean) console.log("WARNING: database not back to baseline");
  process.exit(failures.length === 0 && clean ? 0 : 1);
}
