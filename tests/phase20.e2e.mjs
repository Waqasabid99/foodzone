import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions } from "../src/lib/db-pool.js";

/**
 * Phase 20 — Marketing: the offers, and the codes that unlock them.
 *
 * Three things are proved here.
 *
 * **A coupon code is a bearer token.** An unscoped list handed every code in
 * the company to anyone who could read one outlet's — codes they could spend
 * or pass on. This is the seventh table with the same leak and the first
 * where the leaked value is directly spendable.
 *
 * **A promotion reaches a *list* of branches.** Every other record in the
 * system belongs to exactly one, so the shared single-branch helper would
 * have checked the first id and waved through an offer covering five more.
 * Marketing has its own access module for that reason.
 *
 * **Revoking is by campaign tag, and tags collide.** Nothing stops two
 * outlets naming a batch "summer". Killing your own print run must not kill
 * somebody else's that happens to share a label.
 *
 * Start a server first:
 *   APP_URL=http://localhost:3100 CRON_SECRET=phase2-test-secret npx next start -p 3100
 */
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });

const stamp = Date.now();
const tag = `e2e20-${stamp}`;
const emailOf = (name) => `${tag}-${name}@example.test`;
const short = String(stamp).slice(-5);
const created = { userIds: new Set(), branchIds: new Set(), roleIds: new Set(), promotionIds: new Set(), categoryIds: new Set() };

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log("PASS ", name);
  } else {
    failures.push(name);
    console.log("FAIL ", name, detail !== undefined ? " :: " + JSON.stringify(detail).slice(0, 300) : "");
  }
}

let ipCounter = 0;
const nextIp = () => `10.93.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;

async function api(pathname, { method = "GET", body, token } = {}) {
  const res = await fetch(`${BASE}/api/v1${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": nextIp(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
}

async function page(pathname, cookie) {
  const res = await fetch(`${BASE}${pathname}`, { headers: { cookie, "x-forwarded-for": nextIp() }, redirect: "manual" });
  return { status: res.status, location: res.headers.get("location"), html: res.status === 200 ? await res.text() : "" };
}

async function loginCookies(email, password) {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
    body: JSON.stringify({ email, password, client: "WEB" }),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const body = await res.json();
  return { token: body?.data?.accessToken, cookie: setCookie.map((line) => line.split(";")[0]).join("; ") };
}

async function account(name, password) {
  const reg = await api("/auth/register", { method: "POST", body: { name, email: emailOf(name), password } });
  const id = reg.body?.data?.user?.id;
  if (!id) throw new Error(`could not register ${name}: ${JSON.stringify(reg.body)}`);
  created.userIds.add(id);
  await prisma.user.update({ where: { id }, data: { emailVerifiedAt: new Date(), status: "ACTIVE" } });
  const session = await loginCookies(emailOf(name), password);
  return { id, ...session };
}

const rows = (res) => res.body?.data?.items ?? res.body?.data ?? [];
const ids = (res) => rows(res).map((row) => row.id);
const codes = (res) => rows(res).map((row) => row.code);

async function main() {
  // ================= SETUP =================
  const admin = await account("admin", "admin-passphrase-20");
  await prisma.user.update({ where: { id: admin.id }, data: { isSuperAdmin: true } });
  const relogin = await loginCookies(emailOf("admin"), "admin-passphrase-20");
  const adminToken = relogin.token;
  admin.cookie = relogin.cookie;

  const mine = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: `M${short}`, name: `P20 Mine ${short}`, city: "Karachi", timezone: "Asia/Karachi" },
  });
  const theirs = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: `N${short}`, name: `P20 Theirs ${short}`, city: "Lahore", timezone: "Asia/Karachi" },
  });
  check("two branches exist", mine.status === 201 && theirs.status === 201, { mine: mine.body?.error, theirs: theirs.body?.error });
  const mineId = mine.body.data.id;
  const theirsId = theirs.body.data.id;
  created.branchIds.add(mineId);
  created.branchIds.add(theirsId);

  const category = await api("/admin/categories", { method: "POST", token: adminToken, body: { name: `P20 Mains ${short}` } });
  created.categoryIds.add(category.body.data.id);

  // ================= OFFERS OF EACH REACH =================
  const makeOffer = async (name, branchIds, extra = {}) => {
    const res = await api("/admin/promotions", {
      method: "POST",
      token: adminToken,
      body: { name, type: "PERCENTAGE", value: 10, branchIds, requiresCoupon: true, ...extra },
    });
    if (res.body?.data?.id) created.promotionIds.add(res.body.data.id);
    return res;
  };

  const ourOffer = await makeOffer(`P20 Ours ${short}`, [mineId]);
  const theirOffer = await makeOffer(`P20 Theirs ${short}`, [theirsId]);
  const chainOffer = await makeOffer(`P20 Chain ${short}`, []);
  check("an offer at each branch and one chain-wide", [ourOffer, theirOffer, chainOffer].every((r) => r.status === 201), {
    ours: ourOffer.body?.error,
    theirs: theirOffer.body?.error,
    chain: chainOffer.body?.error,
  });
  const ourOfferId = ourOffer.body.data.id;
  const theirOfferId = theirOffer.body.data.id;
  const chainOfferId = chainOffer.body.data.id;

  // --- the rules the server enforces on what an offer can be ---
  const impossible = await api("/admin/promotions", {
    method: "POST",
    token: adminToken,
    body: { name: `P20 Bad ${short}`, type: "PERCENTAGE", value: 150, branchIds: [mineId] },
  });
  check("a percentage over 100 is refused", impossible.status === 400, { status: impossible.status });

  const cappedFixed = await api("/admin/promotions", {
    method: "POST",
    token: adminToken,
    body: { name: `P20 Bad2 ${short}`, type: "FIXED_AMOUNT", value: 300, maxDiscountAmount: 50, branchIds: [mineId] },
  });
  check("a cap on a fixed amount is refused as a contradiction", cappedFixed.status === 400, { status: cappedFixed.status });

  const halfWindow = await api("/admin/promotions", {
    method: "POST",
    token: adminToken,
    body: { name: `P20 Bad3 ${short}`, type: "FREE_DELIVERY", startMinute: 600, branchIds: [mineId] },
  });
  check("half a time window is refused", halfWindow.status === 400, { status: halfWindow.status });

  const overnight = await api("/admin/promotions", {
    method: "POST",
    token: adminToken,
    body: { name: `P20 Night ${short}`, type: "FREE_DELIVERY", startMinute: 1380, endMinute: 1560, branchIds: [mineId] },
  });
  check("a window crossing midnight is accepted", overnight.status === 201, overnight.body?.error);
  if (overnight.body?.data?.id) created.promotionIds.add(overnight.body.data.id);

  // ================= CODES =================
  const singleCode = await api("/admin/coupons", {
    method: "POST",
    token: adminToken,
    body: { code: `OURS${short}`, promotionId: ourOfferId, maxRedemptions: 5 },
  });
  const theirCode = await api("/admin/coupons", {
    method: "POST",
    token: adminToken,
    body: { code: `THEIRS${short}`, promotionId: theirOfferId, maxRedemptions: 5 },
  });
  const chainCode = await api("/admin/coupons", {
    method: "POST",
    token: adminToken,
    body: { code: `CHAIN${short}`, promotionId: chainOfferId, maxRedemptions: 5 },
  });
  check("a code for each offer", [singleCode, theirCode, chainCode].every((r) => r.status === 201), {
    ours: singleCode.body?.error,
    theirs: theirCode.body?.error,
    chain: chainCode.body?.error,
  });
  const ourCodeId = singleCode.body.data.id;
  const theirCodeId = theirCode.body.data.id;

  const lowered = await api("/admin/coupons", {
    method: "POST",
    token: adminToken,
    body: { code: `lower${short}`, promotionId: ourOfferId },
  });
  check("a lower-case code is stored upper-case", lowered.body?.data?.code === `LOWER${short}`, lowered.body?.data?.code);

  // Two batches at different branches sharing a name — the collision that
  // makes revoke-by-tag dangerous.
  const sharedTag = `summer-${short}`;
  const ourBatch = await api("/admin/coupons/generate", {
    method: "POST",
    token: adminToken,
    body: { promotionId: ourOfferId, count: 5, prefix: "OB", length: 6, campaign: sharedTag },
  });
  const theirBatch = await api("/admin/coupons/generate", {
    method: "POST",
    token: adminToken,
    body: { promotionId: theirOfferId, count: 5, prefix: "TB", length: 6, campaign: sharedTag },
  });
  check("both branches generate a batch under the same name", ourBatch.status === 201 && theirBatch.status === 201, {
    ours: ourBatch.body?.error,
    theirs: theirBatch.body?.error,
  });

  const theirBatchBefore = await prisma.coupon.count({ where: { campaign: sharedTag, promotionId: theirOfferId, isActive: true } });
  check("the other branch's batch starts active", theirBatchBefore === 5, { theirBatchBefore });

  // ================= THE WALL =================
  const marketer = await account("marketer", "marketer-passphrase-20");
  const role = await api("/admin/roles", {
    method: "POST",
    token: adminToken,
    body: {
      key: `p20-marketer-${short}`,
      name: `P20 Marketer ${short}`,
      permissionKeys: [
        "promotions.read",
        "promotions.create",
        "promotions.update",
        "promotions.activate",
        "promotions.delete",
        "coupons.read",
        "coupons.create",
        "coupons.update",
        "coupons.generate_bulk",
      ],
    },
  });
  check("a marketing role can be created", role.status === 201, role.body?.error);
  if (role.status === 201) created.roleIds.add(role.body.data.id);
  await api(`/admin/users/${marketer.id}/roles`, { method: "POST", token: adminToken, body: { roleId: role.body.data.id, branchId: mineId } });
  const scoped = await loginCookies(emailOf("marketer"), "marketer-passphrase-20");
  const scopedToken = scoped.token;

  const promoList = await api("/admin/promotions?limit=100", { token: scopedToken });
  const promoIds = ids(promoList);
  check("a scoped marketer can list offers", promoList.status === 200, promoList.body?.error);
  check("their own branch's offer is listed", promoIds.includes(ourOfferId), { listed: promoIds.length });
  check("a chain-wide offer is listed too", promoIds.includes(chainOfferId), { listed: promoIds.length });
  // The leak this phase exists for.
  check("another branch's offer is NOT listed", !promoIds.includes(theirOfferId), { listed: promoIds.length, leaked: theirOfferId });

  const couponList = await api("/admin/coupons?limit=100", { token: scopedToken });
  const couponIds = ids(couponList);
  const couponCodes = codes(couponList);
  check("a scoped marketer can list codes", couponList.status === 200, couponList.body?.error);
  check("their own code is listed", couponIds.includes(ourCodeId), { listed: couponIds.length });
  // A code is spendable. This is the sharpest version of the leak.
  check("another branch's code is NOT listed", !couponIds.includes(theirCodeId), { leaked: theirCodeId });
  check("no code from the other branch's batch is listed", !couponCodes.some((code) => code?.startsWith("TB")), {
    leaked: couponCodes.filter((code) => code?.startsWith("TB")),
  });
  check("their own batch is listed", couponCodes.some((code) => code?.startsWith("OB")), { listed: couponCodes.length });

  for (const [label, path] of [
    ["offer", `/admin/promotions/${theirOfferId}`],
    ["code", `/admin/coupons/${theirCodeId}`],
    ["redemptions", `/admin/coupons/${theirCodeId}/redemptions`],
  ]) {
    const direct = await api(path, { token: scopedToken });
    // 404, not 403: a 403 confirms the id is real.
    check(`another branch's ${label} is a 404 by direct id`, direct.status === 404, { status: direct.status });
  }

  const ownOffer = await api(`/admin/promotions/${ourOfferId}`, { token: scopedToken });
  check("their own offer still opens", ownOffer.status === 200, ownOffer.body?.error);
  const chainRead = await api(`/admin/promotions/${chainOfferId}`, { token: scopedToken });
  check("a chain-wide offer is readable by a scoped marketer", chainRead.status === 200, chainRead.body?.error);

  // --- writing ---
  const chainAttempt = await api("/admin/promotions", {
    method: "POST",
    token: scopedToken,
    body: { name: `P20 Sneaky chain ${short}`, type: "PERCENTAGE", value: 50, branchIds: [] },
  });
  check("a branch-pinned role cannot create a chain-wide offer", chainAttempt.status === 403, { status: chainAttempt.status });

  const otherBranchAttempt = await api("/admin/promotions", {
    method: "POST",
    token: scopedToken,
    body: { name: `P20 Sneaky other ${short}`, type: "PERCENTAGE", value: 50, branchIds: [theirsId] },
  });
  check("nor one that runs at a branch they do not cover", otherBranchAttempt.status === 403, { status: otherBranchAttempt.status });

  const ownCreate = await api("/admin/promotions", {
    method: "POST",
    token: scopedToken,
    body: { name: `P20 Theirs own ${short}`, type: "PERCENTAGE", value: 15, branchIds: [mineId] },
  });
  check("but can create one at their own branch", ownCreate.status === 201, ownCreate.body?.error);
  if (ownCreate.body?.data?.id) created.promotionIds.add(ownCreate.body.data.id);

  const widen = await api(`/admin/promotions/${ownCreate.body.data.id}`, {
    method: "PATCH",
    token: scopedToken,
    body: { branchIds: [] },
  });
  check("widening their own offer to the whole chain is refused", widen.status === 403, { status: widen.status });

  const editChain = await api(`/admin/promotions/${chainOfferId}`, {
    method: "PATCH",
    token: scopedToken,
    body: { value: 99 },
  });
  check("editing a chain-wide offer is refused", editChain.status === 403, { status: editChain.status });

  const pauseTheirs = await api(`/admin/promotions/${theirOfferId}/active`, {
    method: "PATCH",
    token: scopedToken,
    body: { isActive: false },
  });
  check("pausing another branch's offer is a 404", pauseTheirs.status === 404, { status: pauseTheirs.status });

  const generateOnTheirs = await api("/admin/coupons/generate", {
    method: "POST",
    token: scopedToken,
    body: { promotionId: theirOfferId, count: 3, campaign: `sneaky-${short}` },
  });
  check("generating codes for another branch's offer is a 404", generateOnTheirs.status === 404, { status: generateOnTheirs.status });

  const codeOnTheirs = await api("/admin/coupons", {
    method: "POST",
    token: scopedToken,
    body: { code: `SNEAK${short}`, promotionId: theirOfferId },
  });
  check("making a code for another branch's offer is a 404", codeOnTheirs.status === 404, { status: codeOnTheirs.status });

  // --- the tag collision ---
  const revoke = await api("/admin/coupons/revoke", { method: "POST", token: scopedToken, body: { campaign: sharedTag } });
  check("they can revoke their own batch", revoke.status === 200, revoke.body?.error);
  check("and it revoked only their five", revoke.body?.data?.revoked === 5, revoke.body?.data);

  const theirBatchAfter = await prisma.coupon.count({ where: { campaign: sharedTag, promotionId: theirOfferId, isActive: true } });
  // The whole point: two outlets chose the same label, and one must not be
  // able to switch off the other's print run.
  check("the other branch's identically-named batch is untouched", theirBatchAfter === 5, { theirBatchAfter });

  const ourBatchAfter = await prisma.coupon.count({ where: { campaign: sharedTag, promotionId: ourOfferId, isActive: true } });
  check("their own batch really was switched off", ourBatchAfter === 0, { ourBatchAfter });

  // ================= A CODE STILL WORKS FOR A CUSTOMER =================
  const validate = await api("/coupons/validate", { method: "POST", body: { code: `CHAIN${short}` } });
  check("a customer-facing code check still answers", [200, 400, 404, 422].includes(validate.status), { status: validate.status });

  // ================= THE SCREENS =================
  const screens = [
    "/dashboard/promotions",
    "/dashboard/promotions?state=live",
    "/dashboard/promotions?state=paused",
    "/dashboard/promotions/new",
    `/dashboard/promotions/${ourOfferId}`,
    `/dashboard/promotions/${chainOfferId}`,
    "/dashboard/coupons",
    `/dashboard/coupons?promotion=${ourOfferId}`,
    `/dashboard/coupons?campaign=${sharedTag}`,
  ];
  for (const path of screens) {
    const res = await page(path, admin.cookie);
    check(`${path} renders`, res.status === 200, { status: res.status, location: res.location });
  }

  const unknown = await page("/dashboard/promotions/not-an-offer", admin.cookie);
  check("an unknown offer is a 404", unknown.status === 404, { status: unknown.status });

  const scopedPromoPage = await page("/dashboard/promotions", scoped.cookie);
  check(
    "a scoped marketer's list does not name the other branch's offer",
    scopedPromoPage.status === 200 && !scopedPromoPage.html.includes(`P20 Theirs ${short}`),
    { status: scopedPromoPage.status },
  );

  const scopedCouponPage = await page("/dashboard/coupons", scoped.cookie);
  check(
    "a scoped marketer's coupon list does not print the other branch's code",
    scopedCouponPage.status === 200 && !scopedCouponPage.html.includes(`THEIRS${short}`),
    { status: scopedCouponPage.status },
  );

  const theirOfferPage = await page(`/dashboard/promotions/${theirOfferId}`, scoped.cookie);
  check("opening another branch's offer by URL is a 404 page", theirOfferPage.status === 404, { status: theirOfferPage.status });

  const needsCode = await page(`/dashboard/promotions/${ourOfferId}`, admin.cookie);
  check("an offer needing a code says whether one exists", needsCode.html.includes("code"), "no mention of codes");

  const outsider = await account("outsider", "outsider-passphrase-20");
  const outsiderPage = await page("/dashboard/promotions", outsider.cookie);
  check("someone with no marketing permission is sent away", [302, 307].includes(outsiderPage.status), {
    status: outsiderPage.status,
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));
}

async function cleanup() {
  const branchIds = [...created.branchIds];
  const promotionIds = (
    await prisma.promotion.findMany({ where: { OR: [{ id: { in: [...created.promotionIds] } }, { name: { contains: short } }] }, select: { id: true } })
  ).map((r) => r.id);

  await prisma.couponRedemption.deleteMany({ where: { coupon: { promotionId: { in: promotionIds } } } });
  await prisma.orderDiscount.deleteMany({ where: { promotionId: { in: promotionIds } } }).catch(() => {});
  await prisma.coupon.deleteMany({ where: { promotionId: { in: promotionIds } } });
  await prisma.promotionTarget.deleteMany({ where: { promotionId: { in: promotionIds } } });
  await prisma.promotion.deleteMany({ where: { id: { in: promotionIds } } });

  await prisma.category.deleteMany({ where: { id: { in: [...created.categoryIds] } } });
  await prisma.outboxEvent.deleteMany({});
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: [...created.userIds] } }, { branchId: { in: branchIds } }] } });
  await prisma.numberSequence.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: [...created.userIds] } } });
  await prisma.credentialToken.deleteMany({ where: { userId: { in: [...created.userIds] } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: [...created.userIds] } } });
  await prisma.userPermissionOverride.deleteMany({ where: { userId: { in: [...created.userIds] } } });
  await prisma.userRoleAssignment.deleteMany({ where: { userId: { in: [...created.userIds] } } });
  await prisma.userDevice.deleteMany({ where: { userId: { in: [...created.userIds] } } });
  await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: [...created.userIds] } } } });
  await prisma.cart.deleteMany({ where: { userId: { in: [...created.userIds] } } });
  await prisma.rolePermission.deleteMany({ where: { roleId: { in: [...created.roleIds].filter(Boolean) } } });
  await prisma.role.deleteMany({ where: { id: { in: [...created.roleIds].filter(Boolean) } } });
  await prisma.user.deleteMany({ where: { id: { in: [...created.userIds] } } });
  await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });

  console.log(
    "REMAINING",
    JSON.stringify({
      users: await prisma.user.count(),
      branches: await prisma.branch.count(),
      promotions: await prisma.promotion.count(),
      coupons: await prisma.coupon.count(),
      categories: await prisma.category.count(),
      roles: await prisma.role.count(),
    }),
  );
}

try {
  await main();
} catch (error) {
  console.error("PHASE 20 CRASHED", error);
  failures.push("crashed");
} finally {
  await cleanup().catch((error) => console.error("CLEANUP FAILED", error));
  await prisma.$disconnect();
}

process.exit(failures.length ? 1 : 0);
