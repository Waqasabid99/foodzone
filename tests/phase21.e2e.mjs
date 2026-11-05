import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions } from "../src/lib/db-pool.js";

/**
 * Phase 21 — the creator programme's admin surface.
 *
 * Phase 13 proves the engine: attribution, rule resolution, holds, clawbacks.
 * This proves who is allowed to see and do any of it, which is a different
 * question and the one the admin screens depend on.
 *
 * The interesting part of this section is that the answer is **not uniform**,
 * and getting it uniformly wrong in either direction is a bug:
 *
 *   * **An earning is branch data.** It is a cost booked against one branch's
 *     completed order, and `creator_earnings.read` sits on the accountant
 *     role — exactly the one an operator pins to a single outlet. Both the
 *     rows and the totals have to be cut, because a total is a leak too.
 *   * **A commission rule is branch data**, with the same `branchIds` list
 *     shape as a promotion, and it is the sharpest case in the system: a rule
 *     does not merely reveal money, it *writes* it. One saved with an empty
 *     branch list pays out on every order in the company, for ever.
 *   * **A video is not branch data.** Products carry no branch, so an
 *     approved video is on every outlet's product page. Hiding it from a
 *     manager whose own storefront is showing it would be absurd. The control
 *     belongs on the write side instead: approving is a chain-wide publishing
 *     act and takes a chain-wide grant, while rejecting and taking down do
 *     not — both only ever make the storefront smaller.
 *
 * Start a server first:
 *   npm run test:e2e:server
 */
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });

const stamp = Date.now();
const tag = `e2e21-${stamp}`;
const emailOf = (name) => `${tag}-${name}@example.test`;
const short = String(stamp).slice(-5);
const created = {
  userIds: new Set(),
  branchIds: new Set(),
  roleIds: new Set(),
  ruleIds: new Set(),
  categoryIds: new Set(),
  productIds: new Set(),
  creatorIds: new Set(),
  orderIds: new Set(),
};

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
const nextIp = () => `10.94.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;

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

async function main() {
  // ================= SETUP =================
  const admin = await account("admin", "admin-passphrase-21");
  await prisma.user.update({ where: { id: admin.id }, data: { isSuperAdmin: true } });
  const relogin = await loginCookies(emailOf("admin"), "admin-passphrase-21");
  const adminToken = relogin.token;
  admin.cookie = relogin.cookie;

  const mine = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: `C${short}`, name: `P21 Mine ${short}`, city: "Karachi", timezone: "Asia/Karachi" },
  });
  const theirs = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: `D${short}`, name: `P21 Theirs ${short}`, city: "Lahore", timezone: "Asia/Karachi" },
  });
  check("two branches exist", mine.status === 201 && theirs.status === 201, { mine: mine.body?.error, theirs: theirs.body?.error });
  const mineId = mine.body.data.id;
  const theirsId = theirs.body.data.id;
  created.branchIds.add(mineId);
  created.branchIds.add(theirsId);

  // ================= COMMISSION RULES: READING =================
  const makeRule = async (name, branchIds, token = adminToken, extra = {}) => {
    const res = await api("/admin/creator-commission-rules", {
      method: "POST",
      token,
      body: { name, rewardType: "PERCENTAGE", rewardValue: 10, branchIds, ...extra },
    });
    if (res.body?.data?.id) created.ruleIds.add(res.body.data.id);
    return res;
  };

  const ourRule = await makeRule(`P21 Ours ${short}`, [mineId]);
  const theirRule = await makeRule(`P21 Theirs ${short}`, [theirsId]);
  const chainRule = await makeRule(`P21 Chain ${short}`, []);
  check("a rule at each branch and one chain-wide", [ourRule, theirRule, chainRule].every((r) => r.status === 201), {
    ours: ourRule.body?.error,
    theirs: theirRule.body?.error,
    chain: chainRule.body?.error,
  });
  const ourRuleId = ourRule.body.data.id;
  const theirRuleId = theirRule.body.data.id;
  const chainRuleId = chainRule.body.data.id;

  // --- the enum lists have to be the database's, not a plausible copy ---
  const appRule = await makeRule(`P21 App ${short}`, [mineId], adminToken, { channels: ["MOBILE_APP"] });
  check("a rule can be restricted to the mobile app", appRule.status === 201, appRule.body?.error);
  const fakeChannel = await api("/admin/creator-commission-rules", {
    method: "POST",
    token: adminToken,
    body: { name: `P21 Fake ${short}`, rewardType: "PERCENTAGE", rewardValue: 10, branchIds: [mineId], channels: ["APP"] },
  });
  check("a channel that does not exist is refused", fakeChannel.status === 400, { status: fakeChannel.status });
  const fakeType = await api("/admin/creator-commission-rules", {
    method: "POST",
    token: adminToken,
    body: { name: `P21 Fake2 ${short}`, rewardType: "PERCENTAGE", rewardValue: 10, branchIds: [mineId], orderTypes: ["TAKEAWAY"] },
  });
  check("an order type that does not exist is refused", fakeType.status === 400, { status: fakeType.status });

  // --- the coherence rules ---
  const overHundred = await api("/admin/creator-commission-rules", {
    method: "POST",
    token: adminToken,
    body: { name: `P21 Bad ${short}`, rewardType: "PERCENTAGE", rewardValue: 150, branchIds: [mineId] },
  });
  check("a percentage over 100 is refused", overHundred.status === 400, { status: overHundred.status });

  const fixedWithBasis = await api("/admin/creator-commission-rules", {
    method: "POST",
    token: adminToken,
    body: { name: `P21 Bad2 ${short}`, rewardType: "FIXED", rewardValue: 200, basis: "ORDER_TOTAL", branchIds: [mineId] },
  });
  check("a fixed reward with a basis is refused as a contradiction", fixedWithBasis.status === 400, { status: fixedWithBasis.status });

  // ================= THE OBJECT GRAPH BEHIND AN EARNING =================
  // Built directly: phase 13 proves the engine that produces these. What is
  // under test here is who may read them.
  const category = await prisma.category.create({
    data: { name: `P21 Food ${short}`, slug: `p21-food-${short}` },
  });
  created.categoryIds.add(category.id);
  const product = await prisma.product.create({
    data: { name: `P21 Burger ${short}`, slug: `p21-burger-${short}`, categoryId: category.id },
  });
  created.productIds.add(product.id);

  const creatorUser = await account("creator", "creator-passphrase-21");
  const creator = await prisma.creatorProfile.create({
    data: { userId: creatorUser.id, handle: `p21_${short}`, displayName: `P21 Creator ${short}` },
  });
  created.creatorIds.add(creator.id);

  const earningAt = async (branchId, label) => {
    const order = await prisma.order.create({
      data: { orderNumber: `P21-${label}-${short}`, branchId, status: "COMPLETED", grandTotal: 1000 },
    });
    created.orderIds.add(order.id);
    const video = await prisma.creatorVideo.create({
      data: {
        creatorId: creator.id,
        orderId: order.id,
        branchId,
        orderItemId: `p21-${label}-${short}`,
        productId: product.id,
        status: "APPROVED",
        publishedAt: new Date(),
      },
    });
    const attribution = await prisma.creatorOrderAttribution.create({
      data: {
        orderId: order.id,
        videoId: video.id,
        creatorId: creator.id,
        productId: product.id,
        lineAmount: 1000,
        attributedAt: new Date(),
      },
    });
    const earning = await prisma.creatorEarning.create({
      data: {
        creatorId: creator.id,
        videoId: video.id,
        orderId: order.id,
        attributionId: attribution.id,
        status: "CREDITED",
        amount: 100,
        basisAmount: 1000,
        orderCompletedAt: new Date(),
      },
    });
    return { order, video, earning };
  };

  const ours = await earningAt(mineId, "mine");
  const theirsEarning = await earningAt(theirsId, "theirs");
  check("an earning exists at each branch", Boolean(ours.earning.id && theirsEarning.earning.id));

  // ================= THE WALL =================
  const clerk = await account("clerk", "clerk-passphrase-21");
  const role = await api("/admin/roles", {
    method: "POST",
    token: adminToken,
    body: {
      key: `p21-clerk-${short}`,
      name: `P21 Clerk ${short}`,
      permissionKeys: [
        "creators.read",
        "creator_videos.read",
        "creator_videos.review",
        "creator_videos.publish",
        "creator_videos.reject",
        "creator_videos.takedown",
        "creator_commission_rules.read",
        "creator_commission_rules.create",
        "creator_commission_rules.update",
        "creator_commission_rules.delete",
          "creator_earnings.read",
        "creator_earnings.reverse",
        "products.read",
        "products.create",
        "products.update",
        "dashboard.view",
      ],
    },
  });
  check("a creator-programme role can be created", role.status === 201, role.body?.error);
  if (role.status === 201) created.roleIds.add(role.body.data.id);
  await api(`/admin/users/${clerk.id}/roles`, {
    method: "POST",
    token: adminToken,
    body: { roleId: role.body.data.id, branchId: mineId },
  });
  const scoped = await loginCookies(emailOf("clerk"), "clerk-passphrase-21");
  const scopedToken = scoped.token;
  const scopedCookie = scoped.cookie;

  // --- earnings: the rows ---
  const earningList = await api("/admin/creator-earnings?limit=100", { token: scopedToken });
  const earningIds = ids(earningList);
  check("a scoped clerk can list earnings", earningList.status === 200, earningList.body?.error);
  check("their own branch's earning is listed", earningIds.includes(ours.earning.id), { listed: earningIds.length });
  // The leak this phase exists for.
  check("another branch's earning is NOT listed", !earningIds.includes(theirsEarning.earning.id), {
    leaked: theirsEarning.earning.id,
    listed: earningIds.length,
  });

  const theirEarningDirect = await api(`/admin/creator-earnings/${theirsEarning.earning.id}`, { token: scopedToken });
  // 404, not 403: a 403 confirms the id is real.
  check("another branch's earning is a 404 by direct id", theirEarningDirect.status === 404, { status: theirEarningDirect.status });
  const ownEarningDirect = await api(`/admin/creator-earnings/${ours.earning.id}`, { token: scopedToken });
  check("their own earning still opens", ownEarningDirect.status === 200, ownEarningDirect.body?.error);

  // --- earnings: the totals, which are a leak of their own ---
  const scopedSummary = await api("/admin/creator-earnings/summary", { token: scopedToken });
  const fullSummary = await api("/admin/creator-earnings/summary", { token: adminToken });
  check("a scoped clerk gets a summary", scopedSummary.status === 200, scopedSummary.body?.error);
  check(
    "the summary is cut to their branches, not the company's",
    Number(scopedSummary.body.data.creditedTotal) < Number(fullSummary.body.data.creditedTotal),
    { scoped: scopedSummary.body?.data?.creditedTotal, full: fullSummary.body?.data?.creditedTotal },
  );
  check(
    "and the attributed revenue behind it is cut the same way",
    Number(scopedSummary.body.data.attributedRevenue) < Number(fullSummary.body.data.attributedRevenue),
    { scoped: scopedSummary.body?.data?.attributedRevenue, full: fullSummary.body?.data?.attributedRevenue },
  );

  // --- earnings: writing ---
  const reverseTheirs = await api(`/admin/creator-earnings/${theirsEarning.earning.id}/reverse`, {
    method: "POST",
    token: scopedToken,
    body: { reason: "P21 should not be possible" },
  });
  check("clawing back another branch's earning is a 404", reverseTheirs.status === 404, { status: reverseTheirs.status });
  const stillCredited = await prisma.creatorEarning.findUnique({
    where: { id: theirsEarning.earning.id },
    select: { status: true },
  });
  check("and that earning is untouched", stillCredited.status === "CREDITED", stillCredited);

  // --- commission rules: reading ---
  const ruleList = await api("/admin/creator-commission-rules?limit=100", { token: scopedToken });
  const ruleIds = ids(ruleList);
  check("a scoped clerk can list rules", ruleList.status === 200, ruleList.body?.error);
  check("their own branch's rule is listed", ruleIds.includes(ourRuleId), { listed: ruleIds.length });
  check("a chain-wide rule is listed too", ruleIds.includes(chainRuleId), { listed: ruleIds.length });
  check("another branch's rule is NOT listed", !ruleIds.includes(theirRuleId), { leaked: theirRuleId });

  const theirRuleDirect = await api(`/admin/creator-commission-rules/${theirRuleId}`, { token: scopedToken });
  check("another branch's rule is a 404 by direct id", theirRuleDirect.status === 404, { status: theirRuleDirect.status });
  const chainRuleRead = await api(`/admin/creator-commission-rules/${chainRuleId}`, { token: scopedToken });
  check("a chain-wide rule is readable by a scoped clerk", chainRuleRead.status === 200, chainRuleRead.body?.error);

  // --- commission rules: writing, which is where the money is ---
  const sneakyChain = await makeRule(`P21 Sneaky ${short}`, [], scopedToken, { rewardValue: 90 });
  check("a chain-wide rule cannot be written from one branch", sneakyChain.status === 403, {
    status: sneakyChain.status,
    body: sneakyChain.body?.error,
  });

  const sneakyOther = await makeRule(`P21 Sneaky2 ${short}`, [theirsId], scopedToken);
  check("nor one that pays at a branch they do not cover", sneakyOther.status === 403, { status: sneakyOther.status });

  const ownRule = await makeRule(`P21 Theirs own ${short}`, [mineId], scopedToken);
  check("but a rule at their own branch is fine", ownRule.status === 201, ownRule.body?.error);

  const widenToChain = await api(`/admin/creator-commission-rules/${ownRule.body.data.id}`, {
    method: "PATCH",
    token: scopedToken,
    body: { branchIds: [] },
  });
  check("nor can their own rule be widened to the whole chain", widenToChain.status === 403, { status: widenToChain.status });

  const editTheirs = await api(`/admin/creator-commission-rules/${theirRuleId}`, {
    method: "PATCH",
    token: scopedToken,
    body: { rewardValue: 99 },
  });
  check("nor another branch's rule edited", editTheirs.status === 404 || editTheirs.status === 403, { status: editTheirs.status });
  const theirRuleRow = await prisma.creatorCommissionRule.findUnique({ where: { id: theirRuleId }, select: { rewardValue: true } });
  check("and that rule's rate is unchanged", Number(theirRuleRow.rewardValue) === 10, theirRuleRow);

  const deleteTheirs = await api(`/admin/creator-commission-rules/${theirRuleId}`, { method: "DELETE", token: scopedToken });
  check("nor another branch's rule deleted", deleteTheirs.status === 404 || deleteTheirs.status === 403, { status: deleteTheirs.status });

  // ================= PRODUCTS BELONG TO A BRANCH =================
  // A product with no branch is the chain's catalogue; one with a branch
  // belongs to that outlet alone. This is what makes "my branch's menu" a
  // boundary rather than a filter.
  const chainProduct = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: { name: `P21 Chain item ${short}`, categoryId: category.id, price: 500, prepTimeMinutes: 10 },
  });
  check("a chain-wide product can be created by a company-wide admin", chainProduct.status === 201, chainProduct.body?.error);
  if (chainProduct.body?.data?.id) created.productIds.add(chainProduct.body.data.id);

  const theirProduct = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: {
      name: `P21 Theirs item ${short}`,
      categoryId: category.id,
      branchId: theirsId,
      price: 500,
      prepTimeMinutes: 10,
    },
  });
  check("a product can be pinned to one outlet", theirProduct.status === 201, theirProduct.body?.error);
  if (theirProduct.body?.data?.id) created.productIds.add(theirProduct.body.data.id);

  const mineProduct = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: {
      name: `P21 Mine item ${short}`,
      categoryId: category.id,
      branchId: mineId,
      price: 500,
      prepTimeMinutes: 10,
    },
  });
  check("and another to a different outlet", mineProduct.status === 201, mineProduct.body?.error);
  if (mineProduct.body?.data?.id) created.productIds.add(mineProduct.body.data.id);

  const catalogue = await api("/admin/products?limit=100", { token: scopedToken });
  const catalogueIds = ids(catalogue);
  check("a scoped clerk can list products", catalogue.status === 200, catalogue.body?.error);
  check("their own outlet's product is listed", catalogueIds.includes(mineProduct.body.data.id), { listed: catalogueIds.length });
  check("the chain's catalogue is listed too", catalogueIds.includes(chainProduct.body.data.id), { listed: catalogueIds.length });
  check("another outlet's product is NOT listed", !catalogueIds.includes(theirProduct.body.data.id), {
    leaked: theirProduct.body.data.id,
  });

  const theirProductDirect = await api(`/admin/products/${theirProduct.body.data.id}`, { token: scopedToken });
  check("another outlet's product is a 404 by direct id", theirProductDirect.status === 404, { status: theirProductDirect.status });

  const sneakyChainProduct = await api("/admin/products", {
    method: "POST",
    token: scopedToken,
    body: { name: `P21 Sneaky item ${short}`, categoryId: category.id, price: 500, prepTimeMinutes: 10 },
  });
  // No branch means every outlet's catalogue, so it takes a company-wide grant.
  check("a branch-pinned clerk cannot add to the chain's catalogue", sneakyChainProduct.status === 403, {
    status: sneakyChainProduct.status,
    body: sneakyChainProduct.body?.error,
  });

  const sneakyOtherProduct = await api("/admin/products", {
    method: "POST",
    token: scopedToken,
    body: { name: `P21 Sneaky2 ${short}`, categoryId: category.id, branchId: theirsId, price: 500, prepTimeMinutes: 10 },
  });
  check("nor one for an outlet they do not cover", sneakyOtherProduct.status === 403, { status: sneakyOtherProduct.status });

  const ownProduct = await api("/admin/products", {
    method: "POST",
    token: scopedToken,
    body: { name: `P21 Clerk item ${short}`, categoryId: category.id, branchId: mineId, price: 500, prepTimeMinutes: 10 },
  });
  check("but one for their own outlet is fine", ownProduct.status === 201, ownProduct.body?.error);
  if (ownProduct.body?.data?.id) created.productIds.add(ownProduct.body.data.id);

  const promoteToChain = await api(`/admin/products/${ownProduct.body.data.id}`, {
    method: "PATCH",
    token: scopedToken,
    body: { branchId: null },
  });
  check("and they cannot promote it onto the chain's catalogue", promoteToChain.status === 403, {
    status: promoteToChain.status,
  });

  // ================= VIDEOS FOLLOW THE OUTLET THEY WERE FILMED AT =============
  //
  // Rewritten, not patched. This section used to assert that a video reached as
  // far as its *product* did, which made a video of a chain-wide item a
  // chain-wide video: one person's clip of a burger shown at every outlet in
  // the company, including ones in other cities and ones that do not put that
  // item on the menu. A video is one meal bought at one outlet, so it now
  // carries that outlet and is read, moderated and published through it.

  // At the clerk's own outlet, of a product on the chain's catalogue. The
  // product being chain-wide no longer widens the video.
  const pending = await prisma.creatorVideo.create({
    data: {
      creatorId: creator.id,
      orderId: ours.order.id,
      branchId: mineId,
      orderItemId: `p21-pending-${short}`,
      productId: product.id,
      status: "PENDING_REVIEW",
      submittedAt: new Date(),
      attemptCount: 1,
    },
  });

  // Filmed at the other outlet, which this clerk should never see.
  const theirVideo = await prisma.creatorVideo.create({
    data: {
      creatorId: creator.id,
      orderId: theirsEarning.order.id,
      branchId: theirsId,
      orderItemId: `p21-theirs-video-${short}`,
      productId: theirProduct.body.data.id,
      status: "PENDING_REVIEW",
      submittedAt: new Date(),
      attemptCount: 1,
    },
  });

  const videoList = await api("/admin/creator-videos?limit=100&status=PENDING_REVIEW", { token: scopedToken });
  const videoIds = ids(videoList);
  check("a scoped clerk can list videos", videoList.status === 200, videoList.body?.error);
  check("a video filmed at their own outlet is listed", videoIds.includes(pending.id), { listed: videoIds.length });
  // Filmed elsewhere, and not theirs to moderate — even though they can see
  // the chain-wide product it is of.
  check("a video filmed at another outlet is NOT listed", !videoIds.includes(theirVideo.id), {
    leaked: theirVideo.id,
    listed: videoIds.length,
  });

  const theirVideoDirect = await api(`/admin/creator-videos/${theirVideo.id}`, { token: scopedToken });
  check("and is a 404 by direct id", theirVideoDirect.status === 404, { status: theirVideoDirect.status });

  const sneakyReject = await api(`/admin/creator-videos/${theirVideo.id}/review`, {
    method: "POST",
    token: scopedToken,
    body: { decision: "REJECTED", reason: "POOR_VIDEO_QUALITY" },
  });
  check("nor can it be rejected by direct id", sneakyReject.status === 404, { status: sneakyReject.status });

  // --- publishing reaches one outlet now, so a branch-pinned clerk may do it ---
  //
  // A real loosening, and deliberate. Approving used to need a company-wide
  // grant whenever the product was chain-wide, because it changed every
  // storefront. It changes one outlet's page now, so the manager of that
  // outlet is exactly the right person to decide.
  const publishOwn = await api(`/admin/creator-videos/${pending.id}/review`, {
    method: "POST",
    token: scopedToken,
    body: { decision: "APPROVED", checks: { orderVerified: true, productMatched: true, qualityApproved: true } },
  });
  check("a branch-pinned clerk CAN publish a video filmed at their outlet", publishOwn.status === 200, {
    status: publishOwn.status,
    body: publishOwn.body?.error,
  });

  // --- but not one filmed somewhere else, by any route ---
  const ownVideo = await prisma.creatorVideo.create({
    data: {
      creatorId: creator.id,
      orderId: theirsEarning.order.id,
      branchId: theirsId,
      orderItemId: `p21-own-video-${short}`,
      productId: mineProduct.body.data.id,
      status: "PENDING_REVIEW",
      submittedAt: new Date(),
      attemptCount: 1,
    },
  });
  const sneakyApprove = await api(`/admin/creator-videos/${ownVideo.id}/review`, {
    method: "POST",
    token: scopedToken,
    body: { decision: "APPROVED", checks: { orderVerified: true, productMatched: true, qualityApproved: true } },
  });
  check("a branch-pinned clerk cannot publish a video filmed at another outlet", sneakyApprove.status === 404, {
    status: sneakyApprove.status,
    body: sneakyApprove.body?.error,
  });
  const stillPending = await prisma.creatorVideo.findUnique({ where: { id: ownVideo.id }, select: { status: true } });
  check("and that video is still waiting", stillPending.status === "PENDING_REVIEW", stillPending);

  // --- rejecting still works at their own outlet ---
  const toReject = await prisma.creatorVideo.create({
    data: {
      creatorId: creator.id,
      orderId: ours.order.id,
      branchId: mineId,
      orderItemId: `p21-reject-${short}`,
      productId: product.id,
      status: "PENDING_REVIEW",
      submittedAt: new Date(),
      attemptCount: 1,
    },
  });
  const reject = await api(`/admin/creator-videos/${toReject.id}/review`, {
    method: "POST",
    token: scopedToken,
    body: { decision: "REJECTED", reason: "POOR_VIDEO_QUALITY", note: "P21" },
  });
  check("and they can send one back", reject.status === 200, reject.body?.error);

  // --- and a company-wide admin can publish ---
  const resubmitted = await prisma.creatorVideo.update({
    where: { id: pending.id },
    data: { status: "PENDING_REVIEW", attemptCount: 2 },
  });
  const adminApprove = await api(`/admin/creator-videos/${resubmitted.id}/review`, {
    method: "POST",
    token: adminToken,
    body: { decision: "APPROVED", checks: { orderVerified: true, productMatched: true, qualityApproved: true } },
  });
  check("a company-wide admin can publish it", adminApprove.status === 200, adminApprove.body?.error);

  const takedown = await api(`/admin/creator-videos/${pending.id}/takedown`, {
    method: "POST",
    token: scopedToken,
    body: { reason: "P21 pulled" },
  });
  check("a scoped clerk can take a live video down", takedown.status === 200, takedown.body?.error);

  // Putting it back up republishes it — to one outlet, which is theirs.
  const reinstate = await api(`/admin/creator-videos/${pending.id}/reinstate`, {
    method: "POST",
    token: scopedToken,
    body: { note: "P21" },
  });
  check("and can put their own outlet's video back up", reinstate.status === 200, {
    status: reinstate.status,
    body: reinstate.body?.error,
  });

  // ================= THE OVERVIEW MIXES TWO PERMISSIONS =================
  const moderator = await account("moderator", "moderator-passphrase-21");
  const modRole = await api("/admin/roles", {
    method: "POST",
    token: adminToken,
    body: {
      key: `p21-mod-${short}`,
      name: `P21 Moderator ${short}`,
      permissionKeys: ["creators.read", "creator_videos.read", "dashboard.view"],
    },
  });
  if (modRole.status === 201) created.roleIds.add(modRole.body.data.id);
  await api(`/admin/users/${moderator.id}/roles`, { method: "POST", token: adminToken, body: { roleId: modRole.body.data.id } });
  const modSession = await loginCookies(emailOf("moderator"), "moderator-passphrase-21");

  const modOverview = await api("/admin/creator-program/overview", { token: modSession.token });
  check("a moderator can open the overview", modOverview.status === 200, modOverview.body?.error);
  check("and still sees how many videos are waiting", typeof modOverview.body.data.pendingReview === "number", modOverview.body?.data);
  // Reached with `creators.read`, which does not imply reading money.
  check("but is given no payout figures at all", modOverview.body.data.earnings === null, {
    earnings: modOverview.body?.data?.earnings,
  });
  check("and no outstanding liability", modOverview.body.data.outstandingCredit === null, {
    outstanding: modOverview.body?.data?.outstandingCredit,
  });

  const adminOverview = await api("/admin/creator-program/overview", { token: adminToken });
  check("a company-wide admin does see the money", adminOverview.body.data.outstandingCredit !== null, {
    outstanding: adminOverview.body?.data?.outstandingCredit,
  });

  const scopedOverview = await api("/admin/creator-program/overview", { token: scopedToken });
  check("a branch-scoped reader sees their own earnings", scopedOverview.body.data.earnings !== null, scopedOverview.body?.data);
  // Null rather than a smaller number: a wallet balance is chain-wide credit
  // and there is no honest way to split it by branch.
  check("but no chain-wide wallet total", scopedOverview.body.data.outstandingCredit === null, {
    outstanding: scopedOverview.body?.data?.outstandingCredit,
  });
  check("and is told why", scopedOverview.body.data.isBranchScoped === true, scopedOverview.body?.data);

  // ================= THE SCREENS =================
  for (const [label, path] of [
    ["creators", "/dashboard/creators"],
    ["creator videos", "/dashboard/creator-videos"],
    ["commission rules", "/dashboard/commission-rules"],
    ["creator earnings", "/dashboard/creator-earnings"],
    ["a new rule", "/dashboard/commission-rules/new"],
    ["one rule", `/dashboard/commission-rules/${ourRuleId}`],
  ]) {
    const res = await page(path, admin.cookie);
    check(`${path} renders`, res.status === 200, { status: res.status, location: res.location });
  }

  const scopedEarningsPage = await page("/dashboard/creator-earnings", scopedCookie);
  check("/dashboard/creator-earnings renders for a scoped clerk", scopedEarningsPage.status === 200, {
    status: scopedEarningsPage.status,
  });
  check(
    "and the page does not name another branch's order",
    !scopedEarningsPage.html.includes(`P21-theirs-${short}`),
    { leaked: `P21-theirs-${short}` },
  );
  check(
    "while it does name their own",
    scopedEarningsPage.html.includes(`P21-mine-${short}`),
    { missing: `P21-mine-${short}` },
  );

  const rulesPage = await page("/dashboard/commission-rules", scopedCookie);
  check(
    "the rules page does not name another branch's rule",
    !rulesPage.html.includes(`P21 Theirs ${short}`),
    { leaked: `P21 Theirs ${short}` },
  );

  // A moderator holds no earnings permission, so the money screen is not theirs.
  const modEarnings = await page("/dashboard/creator-earnings", modSession.cookie);
  check("a moderator is sent away from the earnings screen", modEarnings.status !== 200, { status: modEarnings.status });
}

async function cleanup() {
  const creatorIds = [...created.creatorIds];
  const orderIds = [...created.orderIds];
  const userIds = [...created.userIds];

  await prisma.creatorWalletTransaction.deleteMany({ where: { wallet: { creatorId: { in: creatorIds } } } });
  await prisma.creatorWallet.deleteMany({ where: { creatorId: { in: creatorIds } } });
  await prisma.creatorEarning.deleteMany({ where: { creatorId: { in: creatorIds } } });
  await prisma.creatorOrderAttribution.deleteMany({ where: { creatorId: { in: creatorIds } } });
  await prisma.creatorAttribution.deleteMany({ where: { creatorId: { in: creatorIds } } });
  await prisma.creatorAppreciation.deleteMany({ where: { creatorId: { in: creatorIds } } });
  await prisma.creatorStrike.deleteMany({ where: { creatorId: { in: creatorIds } } });
  await prisma.creatorVideoReview.deleteMany({ where: { video: { creatorId: { in: creatorIds } } } });
  await prisma.creatorVideoAsset.deleteMany({ where: { video: { creatorId: { in: creatorIds } } } });
  await prisma.creatorVideoReview.deleteMany({ where: { video: { productId: { in: [...created.productIds] } } } });
  await prisma.creatorVideo.deleteMany({ where: { OR: [{ creatorId: { in: creatorIds } }, { productId: { in: [...created.productIds] } }] } });
  await prisma.creatorTermsAcceptance.deleteMany({ where: { creatorId: { in: creatorIds } } });
  await prisma.creatorProfile.deleteMany({ where: { id: { in: creatorIds } } });

  await prisma.creatorCommissionRuleTarget.deleteMany({ where: { ruleId: { in: [...created.ruleIds] } } });
  await prisma.creatorCommissionRule.deleteMany({ where: { name: { contains: String(short) } } });

  await prisma.orderStatusEvent.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });

  await prisma.productVariant.deleteMany({ where: { productId: { in: [...created.productIds] } } });
  await prisma.product.deleteMany({ where: { id: { in: [...created.productIds] } } });
  await prisma.category.deleteMany({ where: { id: { in: [...created.categoryIds] } } });

  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: userIds } }] } });
  await prisma.userRoleAssignment.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.credentialToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.userPermissionOverride.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.rolePermission.deleteMany({ where: { roleId: { in: [...created.roleIds].filter(Boolean) } } });
  await prisma.role.deleteMany({ where: { id: { in: [...created.roleIds].filter(Boolean) } } });

  await prisma.branchHour.deleteMany({ where: { branchId: { in: [...created.branchIds] } } });
  await prisma.branch.deleteMany({ where: { id: { in: [...created.branchIds] } } });

  const left = {
    creators: await prisma.creatorProfile.count(),
    rules: await prisma.creatorCommissionRule.count(),
    earnings: await prisma.creatorEarning.count(),
    branches: await prisma.branch.count(),
    users: await prisma.user.count(),
  };
  console.log("REMAINING", JSON.stringify(left));
}

try {
  await main();
} catch (error) {
  console.log("SUITE ERROR:", error.name, "|", error.message, "|", error.stack?.split("\n")[1]?.trim());
  failures.push("suite crashed: " + error.message);
} finally {
  await cleanup().catch((error) => console.log("CLEANUP ERROR:", error.message));
  await prisma.$disconnect();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
