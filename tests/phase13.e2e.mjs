import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions, warmUpDatabase } from "../src/lib/db-pool.js";

/**
 * Phase 13 — the creator program, end to end.
 *
 * Start a server first:
 *   APP_URL=http://localhost:3100 CRON_SECRET=phase2-test-secret npx next dev -p 3100
 *
 * Rule resolution, attribution logic and strike thresholds are pinned in
 * tests/unit.mjs. What only a database can prove is here: that a video is bound
 * to a line the creator actually bought, that a view attributes nothing while
 * an add-to-cart does, that the last video to touch a product wins, that an
 * attribution survives a guest cart being merged at sign-in, that a completed
 * order pays exactly one rule per line, that the hold window works, and that a
 * refund claws the credit back out of the wallet.
 */
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const CRON = process.env.E2E_CRON_SECRET ?? "phase2-test-secret";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });

const stamp = Date.now();
const tag = `e2e13-${stamp}`;
const emailOf = (name) => `${tag}-${name}@example.test`;
const BRANCH_CODE = `E2ED${String(stamp).slice(-5)}`;
const created = { userIds: new Set(), branchIds: new Set() };

/**
 * The programme config as it was before the suite tuned it.
 *
 * Captured so cleanup can put it back. This row is the operator's real
 * configuration, not test data.
 */
let configBefore = null;

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log("PASS ", name);
  } else {
    failures.push(name);
    console.log("FAIL ", name, detail !== undefined ? "::" + JSON.stringify(detail).slice(0, 300) : "");
  }
}

let ipCounter = 0;
const nextIp = () => `10.94.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;

async function api(pathname, { method = "GET", body, token, ip, session } = {}) {
  const res = await fetch(`${BASE}/api/v1${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip ?? nextIp(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(session ? { "x-session-id": session } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: json };
}

/**
 * Adding to the cart is setup for almost every case below, so it was left
 * unchecked. When it failed, the suite reported "your cart is empty" at
 * checkout instead — the wrong step, with none of the reason.
 */
function addedToCart(response) {
  check("the line is added to the cart", response.status === 200 || response.status === 201, response.body?.error);
  return response;
}

/**
 * Drains the outbox until it stops producing work.
 *
 * Handlers enqueue further events, so this is a cascade rather than a queue:
 * completing an order raises `order.status_changed`, whose handler raises the
 * creator earnings event, whose handler raises `creator.appreciation`. A
 * fixed number of drains therefore tests how well the author counted the
 * levels, and adding a level silently stops testing the last one — which is
 * exactly what happened to the "a sale that earned nothing still reaches the
 * appreciation feed" case.
 */
async function drainOutbox(maxRounds = 6) {
  let status = 0;
  for (let round = 0; round < maxRounds; round++) {
    const res = await fetch(`${BASE}/api/internal/jobs/outbox`, {
      method: "POST",
      headers: { authorization: `Bearer ${CRON}` },
    });
    status = res.status;
    if (!res.ok) return status;
    const body = await res.json().catch(() => null);
    const data = body?.data;
    // Nothing claimed this round and nothing waiting: the cascade is spent.
    if (!data || (data.claimed === 0 && (data.stats?.pending ?? 0) === 0)) return status;
  }
  return status;
}

const num = (value) => Number(value ?? 0);
const round = (value, dp = 2) => Math.round(Number(value ?? 0) * 10 ** dp) / 10 ** dp;

/** Drives an order all the way to COMPLETED so it can be filmed and can pay. */
/**
 * Walks an order to COMPLETED.
 *
 * The path depends on the order type — only DELIVERY has a driver leg, and a
 * dine-in order can never be OUT_FOR_DELIVERY. Walking the delivery path for a
 * dine-in order stops at READY, and the order never completes; every creator
 * earning downstream then silently fails to appear.
 */
const COMPLETION_PATH = {
  DELIVERY: ["CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED"],
  PICKUP: ["CONFIRMED", "PREPARING", "READY", "COMPLETED"],
  DINE_IN: ["CONFIRMED", "PREPARING", "READY", "COMPLETED"],
};

async function completeOrder(orderId, adminToken, type = "DINE_IN") {
  for (const status of COMPLETION_PATH[type]) {
    const res = await api(`/admin/orders/${orderId}/status`, {
      method: "PUT",
      token: adminToken,
      body: { status },
    });
    if (res.status !== 200) {
      check(`the order reaches ${status}`, false, res.body?.error);
      return res;
    }
  }
  return { status: 200 };
}

async function main() {
  configBefore = await prisma.creatorProgramConfig.findUnique({ where: { id: "default" } });

  // ================= SETUP =================
  const adminReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P13 Admin", email: emailOf("admin"), password: "admin-passphrase-13" },
  });
  check("the admin account is registered", adminReg.status === 201, adminReg.body?.error ?? adminReg.body);
  const adminId = adminReg.body.data.user.id;
  created.userIds.add(adminId);
  await prisma.user.update({
    where: { id: adminId },
    data: { isSuperAdmin: true, status: "ACTIVE", emailVerifiedAt: new Date() },
  });
  const adminLogin = await api("/auth/login", {
    method: "POST",
    body: { email: emailOf("admin"), password: "admin-passphrase-13" },
  });
  check("the admin signs in", adminLogin.status === 200, adminLogin.body?.error ?? adminLogin.body);
  const adminToken = adminLogin.body.data.accessToken;

  const branch = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: BRANCH_CODE, name: "P13 Branch", city: "Karachi", timezone: "Asia/Karachi" },
  });
  const branchId = branch.body.data.id;
  created.branchIds.add(branchId);

  const category = await api("/admin/categories", {
    method: "POST",
    token: adminToken,
    body: { name: `Burgers ${stamp}`, slug: `burgers-${stamp}` },
  });
  const categoryId = category.body.data.id;

  const product = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: { name: `Smash burger ${stamp}`, categoryId, price: 1000 },
  });
  const productId = product.body.data.id;
  const productSlug = product.body.data.slug;
  await api(`/admin/products/${productId}/publish`, { method: "PUT", token: adminToken, body: { isActive: true } });

  const second = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: { name: `Loaded fries ${stamp}`, categoryId, price: 500 },
  });
  const friesId = second.body.data.id;
  await api(`/admin/products/${friesId}/publish`, { method: "PUT", token: adminToken, body: { isActive: true } });

  const menu = await api("/admin/menus", {
    method: "POST",
    token: adminToken,
    body: {
      branchId,
      name: `All day ${stamp}`,
      type: "DINE_IN",
      isActive: true,
      isDefault: true,
    },
  });
  check("a menu exists", menu.status === 201, menu.body?.error);
  const menuId = menu.body.data.id;

  // Items are added through their own endpoint: `createMenuSchema` has no
  // `sections` field, so passing one here is stripped and the menu is created
  // empty — which surfaces much later as "not on the menu at this branch".
  const listed = await api(`/admin/menus/${menuId}/items`, { method: "POST", token: adminToken, body: { productId } });
  const listedFries = await api(`/admin/menus/${menuId}/items`, {
    method: "POST",
    token: adminToken,
    body: { productId: friesId },
  });
  check(
    "both products are on the menu so they can be ordered",
    listed.status === 201 && listedFries.status === 201,
    listed.body?.error ?? listedFries.body?.error,
  );

  // ================= PROGRAM CONFIG AND TERMS =================
  const config = await api("/admin/creator-program/config", { token: adminToken });
  check("the program has a config row", config.status === 200, config.body?.error);

  const badBounds = await api("/admin/creator-program/config", {
    method: "PATCH",
    token: adminToken,
    body: { minVideoSeconds: 40, maxVideoSeconds: 20 },
  });
  check("a minimum longer than the maximum is refused", badBounds.status === 400, badBounds.body?.error);

  const tuned = await api("/admin/creator-program/config", {
    method: "PATCH",
    token: adminToken,
    body: {
      isEnabled: true,
      minVideoSeconds: 15,
      maxVideoSeconds: 30,
      maxUploadAttempts: 3,
      earningHoldDays: 0,
      attributionWindowDays: 7,
      submissionWindowDays: 30,
      suspendAtStrikePoints: 3,
      banAtStrikePoints: 5,
      maxRedemptionPercent: 50,
    },
  });
  check("the program is configured", tuned.status === 200, tuned.body?.error);

  const terms = await api("/admin/creator-program/terms", {
    method: "POST",
    token: adminToken,
    body: { version: `v-${stamp}`, title: "Creator terms", content: "Film your food. Be honest." },
  });
  check("terms are published", terms.status === 201, terms.body?.error);

  // ================= ELIGIBILITY =================
  const creatorReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P13 Creator", email: emailOf("creator"), password: "creator-passphrase-13" },
  });
  const creatorUserId = creatorReg.body.data.user.id;
  created.userIds.add(creatorUserId);
  await prisma.user.update({ where: { id: creatorUserId }, data: { emailVerifiedAt: new Date(), status: "ACTIVE" } });
  const creatorToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("creator"), password: "creator-passphrase-13" } })
  ).body.data.accessToken;

  const notYet = await api("/me/creator/eligibility", { token: creatorToken });
  check("somebody who never ordered is not eligible", notYet.body.data.eligible === false, notYet.body?.data);
  check("and is told why, not just refused", notYet.body.data.reason === "NO_COMPLETED_ORDER", notYet.body?.data);

  const earlyJoin = await api("/me/creator", {
    method: "POST",
    token: creatorToken,
    body: { displayName: "Asha", acceptTerms: true },
  });
  check("joining without a completed order is refused", earlyJoin.status === 409, earlyJoin.body?.error);

  // The order that unlocks the program, and the line that gets filmed.
  const creatorAddress = await api("/addresses", {
    method: "POST",
    token: creatorToken,
    body: { label: "Home", line1: "1 Test Road", city: "Karachi", state: "Sindh", postalCode: "75500", phone: "03001112222" },
  });
  const creatorAddressId = creatorAddress.body.data.id;

  const creatorSession = `sess-${stamp}-creator`;
  addedToCart(await api("/cart/items", {
    method: "POST",
    token: creatorToken,
    session: creatorSession,
    body: { branchId, type: "DINE_IN", productId, quantity: 1 },
  }));
  const creatorOrder = await api("/checkout", {
    method: "POST",
    token: creatorToken,
    session: creatorSession,
    body: { branchId, type: "DINE_IN" },
  });
  check("the creator places an order", creatorOrder.status === 201, creatorOrder.body?.error);
  const creatorOrderId = creatorOrder.body.data.id;

  await completeOrder(creatorOrderId, adminToken);
  await drainOutbox();

  const nowEligible = await api("/me/creator/eligibility", { token: creatorToken });
  check("a completed order unlocks the program", nowEligible.body.data.eligible === true, nowEligible.body?.data);

  const joined = await api("/me/creator", {
    method: "POST",
    token: creatorToken,
    body: { displayName: `Asha ${stamp}`, acceptTerms: true },
  });
  check("the creator joins", joined.status === 201, joined.body?.error);
  const creatorId = joined.body.data.id;
  const handle = joined.body.data.handle;
  check("a handle is allocated", Boolean(handle), joined.body?.data);
  check("the qualifying order is recorded", joined.body.data.qualifyingOrderId === creatorOrderId, joined.body?.data);

  const acceptance = await prisma.creatorTermsAcceptance.findFirst({ where: { creatorId }, select: { termsId: true } });
  check("joining records the terms acceptance", acceptance?.termsId === terms.body.data.id, acceptance);

  const wallet = await prisma.creatorWallet.findUnique({ where: { creatorId }, select: { id: true, balance: true } });
  check("a wallet exists from day one", Boolean(wallet), wallet);

  const twice = await api("/me/creator", {
    method: "POST",
    token: creatorToken,
    body: { displayName: "Again", acceptTerms: true },
  });
  check("joining twice is refused", twice.status === 409, twice.body?.error);

  // ================= VIDEO: PROOF OF PURCHASE =================
  const filmable = await api("/me/creator/filmable", { token: creatorToken });
  check("filmable lines can be listed", filmable.status === 200, filmable.body?.error ?? filmable.body);
  check("the purchased line is offered for filming", filmable.body?.data?.length === 1, filmable.body?.data);
  const orderItemId = filmable.body.data[0].id;

  // Somebody else's order line is not proof that *you* bought anything.
  const otherReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P13 Other", email: emailOf("other"), password: "other-passphrase-13" },
  });
  const otherUserId = otherReg.body.data.user.id;
  created.userIds.add(otherUserId);
  await prisma.user.update({ where: { id: otherUserId }, data: { emailVerifiedAt: new Date(), status: "ACTIVE" } });
  const otherToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("other"), password: "other-passphrase-13" } })
  ).body.data.accessToken;

  const stolen = await api("/me/creator/videos", {
    method: "POST",
    token: otherToken,
    body: { orderItemId },
  });
  check("you cannot film somebody else's order line", [403, 404, 409].includes(stolen.status), stolen.body?.error);

  const video = await api("/me/creator/videos", {
    method: "POST",
    token: creatorToken,
    body: { orderItemId, caption: "Best burger in town" },
  });
  check("a video is started against the purchased line", video.status === 201, video.body?.error);
  const videoId = video.body.data.id;
  check("the product comes from the line, not the request", video.body.data.productId === productId, video.body?.data);

  const dup = await api("/me/creator/videos", { method: "POST", token: creatorToken, body: { orderItemId } });
  check("one video per purchased line", dup.status === 409, dup.body?.error);

  const asset = (durationSeconds) => ({
    videoUrl: `https://cdn.test/${stamp}-${durationSeconds}.mp4`,
    storageKey: `creator/${stamp}-${durationSeconds}-${Math.random().toString(36).slice(2)}`,
    durationSeconds,
    sizeBytes: 5_000_000,
    mimeType: "video/mp4",
  });

  const tooShort = await api(`/me/creator/videos/${videoId}/asset`, {
    method: "PUT",
    token: creatorToken,
    body: asset(5),
  });
  check("a clip under the minimum is refused", tooShort.status === 400, tooShort.body?.error);

  const tooLong = await api(`/me/creator/videos/${videoId}/asset`, {
    method: "PUT",
    token: creatorToken,
    body: asset(90),
  });
  check("and one over the maximum", tooLong.status === 400, tooLong.body?.error);

  const attached = await api(`/me/creator/videos/${videoId}/asset`, {
    method: "PUT",
    token: creatorToken,
    body: asset(20),
  });
  check("a valid clip attaches", attached.status === 200, attached.body?.error);
  check("as attempt one", attached.body.data.attemptCount === 1, attached.body?.data);

  const submitted = await api(`/me/creator/videos/${videoId}/submit`, { method: "POST", token: creatorToken });
  check("it goes to the review queue", submitted.body?.data?.status === "PENDING_REVIEW", submitted.body);

  // ================= MODERATION =================
  const queue = await api("/admin/creator-videos/queue", { token: adminToken });
  check("the moderator sees it queued", queue.body.data.items.some((row) => row.id === videoId), queue.body?.data);

  const noReason = await api(`/admin/creator-videos/${videoId}/review`, {
    method: "POST",
    token: adminToken,
    body: { decision: "REJECTED" },
  });
  check("a rejection needs a reason", noReason.status === 400, noReason.body?.error);

  const rejected = await api(`/admin/creator-videos/${videoId}/review`, {
    method: "POST",
    token: adminToken,
    body: { decision: "REJECTED", reason: "POOR_VIDEO_QUALITY", note: "Too dark", checks: { orderVerified: true } },
  });
  check("it can be rejected with a reason", rejected.body?.data?.status === "REJECTED", rejected.body);
  check("and the attempts remaining are reported", rejected.body.data.attemptsRemaining === 2, rejected.body?.data);

  const reviewLog = await prisma.creatorVideoReview.findMany({ where: { videoId }, select: { decision: true, reason: true, orderVerified: true } });
  check("every decision is written to the review log", reviewLog.length === 1, reviewLog);
  check("including what the reviewer checked", reviewLog[0].orderVerified === true, reviewLog[0]);

  const reupload = await api(`/me/creator/videos/${videoId}/asset`, {
    method: "PUT",
    token: creatorToken,
    body: asset(22),
  });
  check("a rejected video can be re-uploaded", reupload.status === 200, reupload.body?.error);
  check("as attempt two", reupload.body.data.attemptCount === 2, reupload.body?.data);

  const assets = await prisma.creatorVideoAsset.findMany({ where: { videoId }, select: { attemptNumber: true, isCurrent: true } });
  check("the rejected attempt is kept", assets.length === 2, assets);
  check("and only the newest is current", assets.filter((row) => row.isCurrent).length === 1, assets);

  await api(`/me/creator/videos/${videoId}/submit`, { method: "POST", token: creatorToken });
  const approved = await api(`/admin/creator-videos/${videoId}/review`, {
    method: "POST",
    token: adminToken,
    body: { decision: "APPROVED", checks: { orderVerified: true, productMatched: true, qualityApproved: true } },
  });
  check("it can be approved", approved.body?.data?.status === "APPROVED", approved.body);
  check("and published", Boolean(approved.body.data.publishedAt), approved.body?.data);
  await drainOutbox();

  const firstVideoPraise = await prisma.creatorAppreciation.findFirst({
    where: { creatorId, type: "FIRST_VIDEO_APPROVED" },
    select: { id: true },
  });
  check("the first approval is recognised", Boolean(firstVideoPraise), firstVideoPraise);

  // ================= THE PUBLIC FEED =================
  const onProduct = await api(`/products/${productSlug}/videos?branchId=${branchId}`);
  check("the video is on the product page", onProduct.body?.data?.some((row) => row.id === videoId), onProduct.body?.data);
  check("with the creator attached", Boolean(onProduct.body.data[0]?.creator?.handle), onProduct.body?.data?.[0]);

  /*
   * And nowhere else. A video is one person's meal at one outlet: it used to
   * be served to every branch in the company, including ones in other cities
   * and ones that do not put the item on their menu at all.
   */
  const otherBranch = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: `${BRANCH_CODE}X`, name: "P13 Branch", city: "Lahore", timezone: "Asia/Karachi" },
  });
  const elsewhereId = otherBranch.body?.data?.id;
  if (elsewhereId) created.branchIds.add(elsewhereId);
  check("a second outlet exists to test against", Boolean(elsewhereId), otherBranch.body);

  const atElsewhere = await api(`/products/${productSlug}/videos?branchId=${elsewhereId}`);
  check(
    "but not on another outlet's page",
    Array.isArray(atElsewhere.body?.data) && !atElsewhere.body.data.some((row) => row.id === videoId),
    atElsewhere.body?.data,
  );

  // With no outlet chosen at all, an empty shelf rather than the whole company.
  const noBranch = await api(`/products/${productSlug}/videos`);
  check(
    "and nothing at all when no outlet is chosen",
    Array.isArray(noBranch.body?.data) && noBranch.body.data.length === 0,
    noBranch.body?.data,
  );

  const publicPage = await api(`/creators/${handle}`);
  check("the creator has a public page", publicPage.body?.data?.creator?.handle === handle, publicPage.body);

  // ================= ENGAGEMENT =================
  const viewerSession = `sess-${stamp}-viewer`;
  const viewed = await api(`/creator-videos/${videoId}/view`, {
    method: "POST",
    session: viewerSession,
    body: { watchedSeconds: 20, isComplete: true },
  });
  check("a view is recorded", viewed.body?.data?.counted === true, viewed.body);
  check("and counted as unique the first time", viewed.body.data.unique === true, viewed.body?.data);

  const secondView = await api(`/creator-videos/${videoId}/view`, {
    method: "POST",
    session: viewerSession,
    body: { watchedSeconds: 20 },
  });
  check("a rewatch is not a second unique viewer", secondView.body.data.unique === false, secondView.body?.data);

  const tooShortView = await api(`/creator-videos/${videoId}/view`, {
    method: "POST",
    session: `${viewerSession}-b`,
    body: { watchedSeconds: 1 },
  });
  check("a one-second glance is not a view", tooShortView.body.data.counted === false, tooShortView.body?.data);

  const liked = await api(`/creator-videos/${videoId}/like`, { method: "POST", session: viewerSession, body: {} });
  check("a video can be liked", liked.body?.data?.liked === true, liked.body);
  const unliked = await api(`/creator-videos/${videoId}/like`, { method: "POST", session: viewerSession, body: {} });
  check("and unliked — the like toggles", unliked.body.data.liked === false, unliked.body?.data);
  await api(`/creator-videos/${videoId}/like`, { method: "POST", session: viewerSession, body: {} });

  const shared = await api(`/creator-videos/${videoId}/share`, {
    method: "POST",
    token: creatorToken,
    body: { channel: "WHATSAPP" },
  });
  check("sharing returns a trackable link", Boolean(shared.body?.data?.shareLink?.code), shared.body);
  const shareCode = shared.body.data.shareLink.code;

  const sharedAgain = await api(`/creator-videos/${videoId}/share`, {
    method: "POST",
    token: creatorToken,
    body: { channel: "WHATSAPP" },
  });
  // Otherwise a creator's clicks fragment across a dozen codes and none mean anything.
  check("the same channel reuses the same link", sharedAgain.body.data.shareLink.code === shareCode, sharedAgain.body?.data);

  const followed = await api(`/s/${shareCode}`, { session: `${viewerSession}-ext` });
  check("following the link returns the video", followed.body?.data?.video?.id === videoId, followed.body);
  const linkRow = await prisma.creatorShareLink.findUnique({ where: { code: shareCode }, select: { clickCount: true } });
  check("and records the click", linkRow.clickCount === 1, linkRow);

  // ================= ATTRIBUTION =================
  const afterViews = await prisma.creatorAttribution.count({ where: { videoId } });
  // A product page with six videos would otherwise credit all six for one sale.
  check("watching and sharing attribute nothing", afterViews === 0, afterViews);

  const buyerReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P13 Buyer", email: emailOf("buyer"), password: "buyer-passphrase-13" },
  });
  const buyerUserId = buyerReg.body.data.user.id;
  created.userIds.add(buyerUserId);
  await prisma.user.update({ where: { id: buyerUserId }, data: { emailVerifiedAt: new Date(), status: "ACTIVE" } });
  const buyerToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("buyer"), password: "buyer-passphrase-13" } })
  ).body.data.accessToken;

  const buyerSession = `sess-${stamp}-buyer`;
  const addedFromVideo = await api("/cart/items", {
    method: "POST",
    token: buyerToken,
    session: buyerSession,
    body: { branchId, type: "DINE_IN", productId, quantity: 2, creatorVideoId: videoId, creatorSurface: "PRODUCT_PAGE" },
  });
  check("adding from a video works", addedFromVideo.status === 200 || addedFromVideo.status === 201, addedFromVideo.body?.error);

  const attribution = await prisma.creatorAttribution.findFirst({
    where: { videoId, status: "ACTIVE" },
    select: { id: true, productId: true, creatorId: true, touchCount: true, viewerId: true },
  });
  check("add-to-cart is what creates the attribution", Boolean(attribution), attribution);
  check("it is keyed to the product", attribution?.productId === productId, attribution);

  // A second video for the same product, to prove last touch wins.
  const creator2Reg = await api("/auth/register", {
    method: "POST",
    body: { name: "P13 Creator2", email: emailOf("creator2"), password: "creator2-passphrase-13" },
  });
  const creator2UserId = creator2Reg.body.data.user.id;
  created.userIds.add(creator2UserId);
  await prisma.user.update({ where: { id: creator2UserId }, data: { emailVerifiedAt: new Date(), status: "ACTIVE" } });
  const creator2Token = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("creator2"), password: "creator2-passphrase-13" } })
  ).body.data.accessToken;

  const c2Session = `sess-${stamp}-c2`;
  addedToCart(await api("/cart/items", {
    method: "POST",
    token: creator2Token,
    session: c2Session,
    body: { branchId, type: "DINE_IN", productId, quantity: 1 },
  }));
  const c2Order = await api("/checkout", { method: "POST", token: creator2Token, session: c2Session, body: { branchId, type: "DINE_IN" } });
  await completeOrder(c2Order.body.data.id, adminToken);
  await drainOutbox();
  await api("/me/creator", { method: "POST", token: creator2Token, body: { displayName: `Bilal ${stamp}`, acceptTerms: true } });

  const c2Filmable = await api("/me/creator/filmable", { token: creator2Token });
  const v2 = await api("/me/creator/videos", { method: "POST", token: creator2Token, body: { orderItemId: c2Filmable.body.data[0].id } });
  const video2Id = v2.body.data.id;
  await api(`/me/creator/videos/${video2Id}/asset`, { method: "PUT", token: creator2Token, body: asset(18) });
  await api(`/me/creator/videos/${video2Id}/submit`, { method: "POST", token: creator2Token });
  await api(`/admin/creator-videos/${video2Id}/review`, {
    method: "POST",
    token: adminToken,
    body: { decision: "APPROVED", checks: { orderVerified: true, productMatched: true, qualityApproved: true } },
  });

  addedToCart(await api("/cart/items", {
    method: "POST",
    token: buyerToken,
    session: buyerSession,
    body: { branchId, type: "DINE_IN", productId, quantity: 1, creatorVideoId: video2Id },
  }));

  const afterSecondTouch = await prisma.creatorAttribution.findFirst({
    where: { cartId: attribution ? undefined : undefined, productId, status: "ACTIVE", viewerId: buyerUserId },
    select: { videoId: true, touchCount: true },
  });
  check("the last video to touch the product wins", afterSecondTouch?.videoId === video2Id, afterSecondTouch);
  check("and the touch count grows rather than a second row appearing", afterSecondTouch?.touchCount === 2, afterSecondTouch);

  const touches = await prisma.creatorAttributionTouch.count({ where: { videoId: { in: [videoId, video2Id] } } });
  check("every touch is kept as the audit trail", touches === 2, touches);

  // Put the first creator's video back in front, so it is the one that sells.
  addedToCart(await api("/cart/items", {
    method: "POST",
    token: buyerToken,
    session: buyerSession,
    body: { branchId, type: "DINE_IN", productId, quantity: 1, creatorVideoId: videoId },
  }));

  // ================= COMMISSION RULES =================
  const badPercent = await api("/admin/creator-commission-rules", {
    method: "POST",
    token: adminToken,
    body: { name: "Bad", rewardType: "PERCENTAGE", rewardValue: 150 },
  });
  check("a percentage over 100 is refused", badPercent.status === 400, badPercent.body?.error);

  const globalRule = await api("/admin/creator-commission-rules", {
    method: "POST",
    token: adminToken,
    body: { name: `Global 5% ${stamp}`, rewardType: "PERCENTAGE", rewardValue: 5, basis: "ATTRIBUTED_LINE", priority: 0 },
  });
  check("a global rule is created", globalRule.status === 201, globalRule.body?.error);

  const productRule = await api("/admin/creator-commission-rules", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Burger flat 200 ${stamp}`,
      rewardType: "FIXED",
      rewardValue: 200,
      priority: 0,
      targets: [{ targetType: "PRODUCT", targetId: productId }],
    },
  });
  check("a product-targeted rule is created", productRule.status === 201, productRule.body?.error);
  const productRuleId = productRule.body.data.id;

  const sim = await api("/admin/creator-commission-rules/simulate", {
    method: "POST",
    token: adminToken,
    body: { productId, categoryId, lineAmount: 3000, orderTotal: 3000, quantity: 3, branchId },
  });
  // Two overlapping campaigns must not both pay.
  check("the simulator picks exactly one winner", sim.body?.data?.winner?.id === productRuleId, sim.body?.data);
  check("specificity beats a global rule at the same priority", num(sim.body.data.amount) === 200, sim.body?.data);
  check("and every candidate is explained", sim.body.data.candidates.length === 2, sim.body?.data?.candidates);

  // ================= CHECKOUT AND EARNINGS =================
  const buyerAddress = await api("/addresses", {
    method: "POST",
    token: buyerToken,
    body: { label: "Home", line1: "9 Buyer Street", city: "Karachi", state: "Sindh", postalCode: "75500", phone: "03004445555" },
  });

  const buyerOrder = await api("/checkout", {
    method: "POST",
    token: buyerToken,
    session: buyerSession,
    body: { branchId, type: "DINE_IN" },
  });
  check("the buyer checks out", buyerOrder.status === 201, buyerOrder.body?.error);
  const buyerOrderId = buyerOrder.body.data.id;

  const captured = await prisma.creatorOrderAttribution.findMany({
    where: { orderId: buyerOrderId },
    select: { videoId: true, creatorId: true, quantity: true, lineAmount: true, isSelfPurchase: true },
  });
  check("the attribution is frozen onto the order", captured.length === 1, captured);
  check("crediting the video that last sold it", captured[0]?.videoId === videoId, captured[0]);
  check("with the quantity actually bought", num(captured[0]?.quantity) === 4, captured[0]);
  check("and it is not a self purchase", captured[0]?.isSelfPurchase === false, captured[0]);

  const cartCleared = await prisma.creatorAttribution.count({ where: { status: "ACTIVE", viewerId: buyerUserId } });
  check("the live cart attribution is consumed", cartCleared === 0, cartCleared);

  const beforeComplete = await prisma.creatorEarning.count({ where: { orderId: buyerOrderId } });
  check("nothing is earned until the order completes", beforeComplete === 0, beforeComplete);

  await completeOrder(buyerOrderId, adminToken);
  await drainOutbox();
  await drainOutbox();

  const earning = await prisma.creatorEarning.findFirst({
    where: { orderId: buyerOrderId },
    select: { id: true, status: true, amount: true, ruleNameSnapshot: true, creatorId: true, availableAt: true, basisAmount: true },
  });
  check("completing the order creates an earning", Boolean(earning), earning);
  check("paid by the winning rule", num(earning?.amount) === 200, earning);
  check("with the rule name snapshotted", earning?.ruleNameSnapshot?.includes("Burger flat 200"), earning);
  check("credited to the right creator", earning?.creatorId === creatorId, earning);

  // Re-delivering the completion event must not pay twice.
  await api("/admin/orders", { token: adminToken });
  const replayEnqueued = await prisma.outboxEvent.create({
    data: { eventType: "creator.order_completed", payload: { orderId: buyerOrderId } },
  });
  await drainOutbox();
  const afterReplay = await prisma.creatorEarning.count({ where: { orderId: buyerOrderId } });
  check("a redelivered completion does not pay twice", afterReplay === 1, afterReplay);

  // ================= CREDITING AND THE WALLET =================
  const creditRun = await fetch(`${BASE}/api/internal/jobs/creator-credit`, {
    method: "POST",
    headers: { authorization: `Bearer ${CRON}` },
  });
  check("the crediting job runs", creditRun.status === 200, creditRun.status);

  const credited = await prisma.creatorEarning.findUnique({
    where: { id: earning.id },
    select: { status: true, creditedAt: true },
  });
  check("the earning credits once its hold has passed", credited.status === "CREDITED", credited);

  const walletAfter = await api("/me/creator/wallet", { token: creatorToken });
  check("the wallet balance reflects it", num(walletAfter.body.data.wallet.balance) === 200, walletAfter.body?.data?.wallet);
  check("and the pending mirror comes back off", num(walletAfter.body.data.wallet.pendingBalance) === 0, walletAfter.body?.data?.wallet);
  check("the ledger has one credit row", walletAfter.body.data.transactions.items.length === 1, walletAfter.body?.data?.transactions);

  const redeemable = await api("/me/creator/wallet/redeemable?orderTotal=1000", { token: creatorToken });
  // The cap keeps credit a top-up rather than a way to make orders free.
  check("redemption is capped at the configured percentage", num(redeemable.body.data.redeemable) === 200, redeemable.body?.data);
  const smallOrder = await api("/me/creator/wallet/redeemable?orderTotal=100", { token: creatorToken });
  check("and never exceeds half a small order", num(smallOrder.body.data.redeemable) === 50, smallOrder.body?.data);

  // ================= STORE CREDIT AS A TENDER =================
  /*
   * Credit is a way to pay, not a discount. The bill is unchanged and a
   * `STORE_CREDIT` payment settles part of it — which is the whole reason the
   * money lands against customer credit in the ledger rather than cash: the
   * restaurant was paid when the creator earned it, and booking it as a
   * receipt would count the same money twice.
   */
  const spendSession = `sess-${stamp}-spend`;
  addedToCart(await api("/cart/items", {
    method: "POST",
    token: creatorToken,
    session: spendSession,
    body: { branchId, type: "DINE_IN", productId, quantity: 1 },
  }));

  const spendCart = await api("/cart", { token: creatorToken, session: spendSession });
  const spendTotal = num(spendCart.body?.data?.totals?.grandTotal);
  const quoted = await api(`/me/creator/wallet/redeemable?orderTotal=${spendTotal}`, { token: creatorToken });
  const ceiling = num(quoted.body?.data?.redeemable);
  check("the wallet quotes a ceiling for this basket", ceiling > 0 && ceiling <= spendTotal, { spendTotal, body: quoted.body?.data });

  // Asking for a rupee more than the cap allows is refused outright rather
  // than quietly reduced: the difference would land on a card the customer
  // did not expect to use.
  const tooMuch = await api("/checkout", {
    method: "POST",
    token: creatorToken,
    session: spendSession,
    body: { branchId, type: "DINE_IN", storeCredit: ceiling + 1 },
  });
  check("more credit than the cap allows is refused", tooMuch.status === 400, { status: tooMuch.status, error: tooMuch.body?.error?.message });
  check("and the refusal says what the most is", /most that can be spent/.test(tooMuch.body?.error?.details?.storeCredit?.[0] ?? ""), tooMuch.body?.error?.details);

  const beforeSpend = num((await api("/me/creator/wallet", { token: creatorToken })).body?.data?.wallet?.balance);

  const spent = await api("/checkout", {
    method: "POST",
    token: creatorToken,
    session: spendSession,
    body: { branchId, type: "DINE_IN", storeCredit: ceiling },
  });
  check("an order can be paid with store credit", spent.status === 201, spent.body?.error);
  const creditOrderId = spent.body?.data?.id;

  const creditPayment = await prisma.payment.findFirst({
    where: { orderId: creditOrderId, method: "STORE_CREDIT" },
    select: { id: true, amount: true, status: true, provider: true, capturedAt: true },
  });
  check("a STORE_CREDIT payment records what settled the bill", num(creditPayment?.amount) === ceiling, creditPayment);
  check("captured on creation, with no gateway to wait for", creditPayment?.status === "CAPTURED" && Boolean(creditPayment?.capturedAt), creditPayment);
  check("and no provider, because none was involved", creditPayment?.provider === null, creditPayment);

  const creditOrder = await prisma.order.findUnique({
    where: { id: creditOrderId },
    select: { grandTotal: true, paymentState: true },
  });
  check("the bill itself is untouched — credit paid it, it did not discount it", num(creditOrder?.grandTotal) === spendTotal, { creditOrder, spendTotal });
  check(
    "and the derived state says how much is settled",
    creditOrder?.paymentState === (ceiling >= spendTotal ? "PAID" : "PARTIALLY_PAID"),
    { paymentState: creditOrder?.paymentState, ceiling, spendTotal },
  );

  const afterSpend = await api("/me/creator/wallet", { token: creatorToken });
  check("the balance comes down by what was spent", num(afterSpend.body?.data?.wallet?.balance) === beforeSpend - ceiling, { before: beforeSpend, after: afterSpend.body?.data?.wallet?.balance, ceiling });
  const redemption = (afterSpend.body?.data?.transactions?.items ?? []).find((row) => row.type === "REDEMPTION");
  check("the ledger records the redemption as a debit", num(redemption?.amount) === -ceiling, redemption);
  check("pointing at the order it paid for", redemption?.orderId === creditOrderId, redemption);

  // The loop has to close both ways: credit spent on an order that is then
  // cancelled has to come back, or a customer loses it for food they never got.
  await api(`/admin/orders/${creditOrderId}/cancel`, { method: "POST", token: adminToken, body: { reason: "testing the refund path" } });
  await drainOutbox();

  const afterCancel = await api("/me/creator/wallet", { token: creatorToken });
  check("cancelling the order returns the credit", num(afterCancel.body?.data?.wallet?.balance) === beforeSpend, { before: beforeSpend, after: afterCancel.body?.data?.wallet?.balance });
  const reversal = (afterCancel.body?.data?.transactions?.items ?? []).find((row) => row.type === "REDEMPTION_REVERSAL");
  check("as a reversal row rather than an edit to the debit", num(reversal?.amount) === ceiling, reversal);

  // ================= SELF PURCHASE =================
  const selfSession = `sess-${stamp}-self`;
  addedToCart(await api("/cart/items", {
    method: "POST",
    token: creatorToken,
    session: selfSession,
    body: { branchId, type: "DINE_IN", productId, quantity: 1, creatorVideoId: videoId },
  }));
  const selfOrder = await api("/checkout", { method: "POST", token: creatorToken, session: selfSession, body: { branchId, type: "DINE_IN" } });
  const selfOrderId = selfOrder.body.data.id;

  const selfAttribution = await prisma.creatorOrderAttribution.findFirst({
    where: { orderId: selfOrderId },
    select: { isSelfPurchase: true },
  });
  check("buying through your own video is flagged", selfAttribution?.isSelfPurchase === true, selfAttribution);

  await completeOrder(selfOrderId, adminToken);
  await drainOutbox();
  await drainOutbox();

  const selfEarning = await prisma.creatorEarning.findFirst({
    where: { orderId: selfOrderId },
    select: { status: true, amount: true, disqualifiedReason: true },
  });
  check("and earns nothing", selfEarning?.status === "NOT_QUALIFIED", selfEarning);
  check("with the reason recorded rather than silence", Boolean(selfEarning?.disqualifiedReason), selfEarning);
  check("the amount is zero", num(selfEarning?.amount) === 0, selfEarning);

  const praise = await prisma.creatorAppreciation.findFirst({
    where: { creatorId, type: "SALE_WITHOUT_COMMISSION" },
    select: { id: true, message: true },
  });
  check("a sale that earned nothing still reaches the appreciation feed", Boolean(praise), praise);

  // ================= REVERSAL =================
  const refundable = await api(`/admin/orders/${buyerOrderId}`, { token: adminToken });
  await prisma.outboxEvent.create({
    data: { eventType: "creator.order_reversed", payload: { orderId: buyerOrderId, reason: "Refunded in test" } },
  });
  await drainOutbox();

  const reversed = await prisma.creatorEarning.findUnique({
    where: { id: earning.id },
    select: { status: true, reversedAt: true },
  });
  check("a reversed order claws the earning back", reversed.status === "REVERSED", reversed);

  const walletReversed = await prisma.creatorWallet.findUnique({ where: { creatorId }, select: { balance: true } });
  check("and the credit leaves the wallet", num(walletReversed.balance) === 0, walletReversed);

  const rebuilt = await fetch(`${BASE}/api/internal/jobs/creator-credit`, {
    method: "POST",
    headers: { authorization: `Bearer ${CRON}` },
  });
  const ledgerCheck = await prisma.creatorWalletTransaction.aggregate({
    where: { wallet: { creatorId } },
    _sum: { amount: true },
  });
  check("the ledger and the cached balance agree", num(ledgerCheck._sum.amount) === num(walletReversed.balance), {
    ledger: num(ledgerCheck._sum.amount),
    cached: num(walletReversed.balance),
  });

  // ================= MODERATION OF THE CREATOR =================
  const strike = await api(`/admin/creators/${creatorId}/strikes`, {
    method: "POST",
    token: adminToken,
    body: { reason: "MISLEADING_CONTENT", note: "First warning" },
  });
  check("a strike is issued", strike.status === 201, strike.body?.error);
  check("points are recorded", strike.body.data.strikePoints === 2, strike.body?.data);
  check("two points is not yet a suspension", strike.body.data.status === "ACTIVE", strike.body?.data);

  const second2 = await api(`/admin/creators/${creatorId}/strikes`, {
    method: "POST",
    token: adminToken,
    body: { reason: "REPEATED_REJECTIONS" },
  });
  check("crossing the threshold suspends the account", second2.body?.data?.status === "SUSPENDED", second2.body);

  const blockedUpload = await api("/me/creator/videos", {
    method: "POST",
    token: creatorToken,
    body: { orderItemId },
  });
  check("a suspended creator cannot upload", blockedUpload.status === 403, blockedUpload.body?.error);

  const strikes = await api(`/admin/creators/${creatorId}/strikes`, { token: adminToken });
  const revoke = await api(`/admin/creator-strikes/${strikes.body.data[0].id}/revoke`, {
    method: "POST",
    token: adminToken,
    body: { reason: "Appealed successfully" },
  });
  // Points are recomputed from live strikes, so a revocation genuinely undoes itself.
  check("revoking a strike lifts the suspension it caused", revoke.body?.data?.status === "ACTIVE", revoke.body);

  // ================= TAKEDOWN =================
  const takenDown = await api(`/admin/creator-videos/${video2Id}/takedown`, {
    method: "POST",
    token: adminToken,
    body: { reason: "Shows a competitor's packaging" },
  });
  check("a live video can be taken down", takenDown.body?.data?.status === "TAKEN_DOWN", takenDown.body);

  const goneFromFeed = await api(`/products/${productSlug}/videos`);
  check("and disappears from the product page", !goneFromFeed.body.data.some((row) => row.id === video2Id), goneFromFeed.body?.data);

  const reinstated = await api(`/admin/creator-videos/${video2Id}/reinstate`, {
    method: "POST",
    token: adminToken,
    body: { note: "Reviewed again, it is fine" },
  });
  check("and can be put back", reinstated.body?.data?.status === "APPROVED", reinstated.body);

  // ================= ATTEMPT LIMIT =================
  const lockOrderSession = `sess-${stamp}-lock`;
  addedToCart(await api("/cart/items", {
    method: "POST",
    token: creator2Token,
    session: lockOrderSession,
    body: { branchId, type: "DINE_IN", productId: friesId, quantity: 1 },
  }));
  const lockOrder = await api("/checkout", { method: "POST", token: creator2Token, session: lockOrderSession, body: { branchId, type: "DINE_IN" } });
  await completeOrder(lockOrder.body.data.id, adminToken);
  await drainOutbox();

  const lockFilmable = await api("/me/creator/filmable", { token: creator2Token });
  const lockItem = lockFilmable.body.data.find((row) => row.productId === friesId);
  const lockVideo = await api("/me/creator/videos", { method: "POST", token: creator2Token, body: { orderItemId: lockItem.id } });
  const lockVideoId = lockVideo.body.data.id;

  let lockStatus = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await api(`/me/creator/videos/${lockVideoId}/asset`, { method: "PUT", token: creator2Token, body: asset(16 + attempt) });
    await api(`/me/creator/videos/${lockVideoId}/submit`, { method: "POST", token: creator2Token });
    const decision = await api(`/admin/creator-videos/${lockVideoId}/review`, {
      method: "POST",
      token: adminToken,
      body: { decision: "REJECTED", reason: "POOR_VIDEO_QUALITY" },
    });
    lockStatus = decision.body?.data;
  }
  check("the third rejection locks the line", lockStatus?.status === "LOCKED", lockStatus);
  check("with no attempts left", lockStatus?.attemptsRemaining === 0, lockStatus);

  const afterLock = await api(`/me/creator/videos/${lockVideoId}/asset`, {
    method: "PUT",
    token: creator2Token,
    body: asset(20),
  });
  check("and no further uploads are accepted", afterLock.status === 409, afterLock.body?.error);

  // ================= DASHBOARD AND PERMISSIONS =================
  const dashboard = await api("/me/creator", { token: creatorToken });
  check("the dashboard loads", dashboard.status === 200, dashboard.body?.error);
  check("it shows the wallet", dashboard.body.data.wallet != null, dashboard.body?.data);
  check("and what needs attention", dashboard.body.data.videos != null, dashboard.body?.data);

  const performance = await api("/me/creator/performance", { token: creatorToken });
  const perfRow = performance.body.data.videos.find((row) => row.id === videoId);
  check("performance reports the funnel, not just views", perfRow?.addToCartRate != null, perfRow);

  const feed = await api("/me/creator/appreciation", { token: creatorToken });
  check("the appreciation feed has entries", feed.body.data.items.length > 0, feed.body?.data);

  const notMine = await api(`/me/creator/videos/${lockVideoId}`, { token: creatorToken });
  check("a creator cannot read another creator's video", notMine.status === 404, notMine.body?.error);

  const noAdmin = await api("/admin/creator-earnings", { token: creatorToken });
  check("nor the admin earnings list", noAdmin.status === 403, noAdmin.body?.error);

  const ownEarnings = await api("/me/creator/earnings", { token: creatorToken });
  check("but can read their own earnings", ownEarnings.status === 200, ownEarnings.body?.error);
  check("scoped to themselves", ownEarnings.body.data.items.every((row) => row.creatorId === creatorId), ownEarnings.body?.data);

  const overview = await api("/admin/creator-program/overview", { token: adminToken });
  check("the admin overview reports the outstanding liability", overview.body?.data?.outstandingCredit != null, overview.body?.data);
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { contains: tag } }, select: { id: true } });
  const ids = [...new Set([...created.userIds, ...users.map((u) => u.id)])];
  const branchIds = [...created.branchIds];

  const creators = await prisma.creatorProfile.findMany({ where: { userId: { in: ids } }, select: { id: true } });
  const creatorIds = creators.map((c) => c.id);
  // By branch *or* by who placed it. Gathering only by branch leaves an
  // order belonging to a test user behind, and it then blocks the user
  // delete with a foreign key error that names nothing useful.
  const orders = await prisma.order.findMany({
    where: { OR: [{ branchId: { in: branchIds } }, { userId: { in: ids } }] },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);

  await prisma.creatorWalletTransaction.deleteMany({ where: { wallet: { creatorId: { in: creatorIds } } } });
  await prisma.creatorWallet.deleteMany({ where: { creatorId: { in: creatorIds } } });
  await prisma.creatorEarning.deleteMany({ where: { creatorId: { in: creatorIds } } });
  await prisma.creatorAppreciation.deleteMany({ where: { creatorId: { in: creatorIds } } });
  await prisma.creatorStrike.deleteMany({ where: { creatorId: { in: creatorIds } } });
  await prisma.creatorOrderAttribution.deleteMany({ where: { OR: [{ creatorId: { in: creatorIds } }, { orderId: { in: orderIds } }] } });
  await prisma.creatorAttributionTouch.deleteMany({ where: { creatorId: { in: creatorIds } } });
  await prisma.creatorAttribution.deleteMany({ where: { creatorId: { in: creatorIds } } });
  await prisma.creatorShareLinkClick.deleteMany({ where: { shareLink: { creatorId: { in: creatorIds } } } });
  await prisma.creatorVideoShare.deleteMany({ where: { video: { creatorId: { in: creatorIds } } } });
  await prisma.creatorShareLink.deleteMany({ where: { creatorId: { in: creatorIds } } });
  await prisma.creatorVideoLike.deleteMany({ where: { video: { creatorId: { in: creatorIds } } } });
  await prisma.creatorVideoView.deleteMany({ where: { video: { creatorId: { in: creatorIds } } } });
  await prisma.creatorVideoDailyStat.deleteMany({ where: { video: { creatorId: { in: creatorIds } } } });
  await prisma.creatorVideoReview.deleteMany({ where: { video: { creatorId: { in: creatorIds } } } });
  await prisma.creatorVideoAsset.deleteMany({ where: { video: { creatorId: { in: creatorIds } } } });
  await prisma.creatorVideo.deleteMany({ where: { creatorId: { in: creatorIds } } });
  await prisma.creatorCommissionRuleTarget.deleteMany({ where: { rule: { name: { contains: String(stamp) } } } });
  await prisma.creatorCommissionRule.deleteMany({ where: { name: { contains: String(stamp) } } });
  await prisma.creatorTermsAcceptance.deleteMany({ where: { creatorId: { in: creatorIds } } });
  await prisma.creatorProfile.deleteMany({ where: { id: { in: creatorIds } } });
  await prisma.creatorTerms.deleteMany({ where: { version: { contains: String(stamp) } } });
  // Restored, not deleted. This is one admin-owned row holding the real
  // programme settings — hold days, attempt limits, strike thresholds — which
  // the suite edits at the start. Deleting it threw the operator's
  // configuration away every run.
  if (configBefore) {
    await prisma.creatorProgramConfig.upsert({
      where: { id: configBefore.id },
      update: configBefore,
      create: configBefore,
    });
  } else {
    await prisma.creatorProgramConfig.deleteMany({ where: { id: "default" } });
  }

  // By branch *or* by the order behind it. Completing an order posts a
  // journal entry, and one whose branch is not in this set survives a
  // branch-only sweep and then blocks the order delete.
  const journalWhere = { OR: [{ branchId: { in: branchIds } }, { orderId: { in: orderIds } }] };
  await prisma.journalLine.deleteMany({ where: { entry: journalWhere } });
  await prisma.journalEntry.deleteMany({ where: journalWhere });
  await prisma.stockMovement.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.orderStatusEvent.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderItemModifier.deleteMany({ where: { orderItem: { orderId: { in: orderIds } } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderDiscount.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.invoice.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });

  await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: ids } } } });
  await prisma.cart.deleteMany({ where: { OR: [{ userId: { in: ids } }, { sessionId: { contains: String(stamp) } }] } });
  await prisma.menuItem.deleteMany({ where: { section: { menu: { branchId: { in: branchIds } } } } });
  await prisma.menuSection.deleteMany({ where: { menu: { branchId: { in: branchIds } } } });
  await prisma.menu.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.productVariant.deleteMany({ where: { product: { slug: { contains: String(stamp) } } } });
  await prisma.product.deleteMany({ where: { slug: { contains: String(stamp) } } });
  await prisma.category.deleteMany({ where: { slug: { contains: String(stamp) } } });

  // Finished rows only. An unfiltered delete here throws away pending work
  // that belongs to the application, not to this suite.
  await prisma.outboxEvent.deleteMany({ where: { status: { in: ["DONE", "FAILED"] } } });
  await prisma.numberSequence.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.address.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.credentialToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userRoleAssignment.deleteMany({ where: { userId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  // This run's branches only. Matching the `E2ED` prefix swept up branches
  // left behind by *other* runs whose rows this cleanup never gathered, so
  // the delete failed on their foreign keys and took the whole teardown —
  // and the run's summary — down with it.
  await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });

  const leftovers = {
    users: await prisma.user.count(),
    branches: await prisma.branch.count(),
    creators: await prisma.creatorProfile.count(),
    videos: await prisma.creatorVideo.count(),
    attributions: await prisma.creatorAttribution.count(),
    orderAttributions: await prisma.creatorOrderAttribution.count(),
    rules: await prisma.creatorCommissionRule.count(),
    earnings: await prisma.creatorEarning.count(),
    wallets: await prisma.creatorWallet.count(),
    walletTxns: await prisma.creatorWalletTransaction.count(),
    terms: await prisma.creatorTerms.count(),
    orders: await prisma.order.count(),
    products: await prisma.product.count(),
    outbox: await prisma.outboxEvent.count(),
    roles: await prisma.role.count(),
    accounts: await prisma.account.count(),
  };
  console.log("\nDatabase after cleanup:", JSON.stringify(leftovers));
  return leftovers;
}

/** The counts this suite is accountable for putting back. */
async function census() {
  return {
    users: await prisma.user.count(),
    branches: await prisma.branch.count(),
    creators: await prisma.creatorProfile.count(),
    videos: await prisma.creatorVideo.count(),
    attributions: await prisma.creatorAttribution.count(),
    orderAttributions: await prisma.creatorOrderAttribution.count(),
    rules: await prisma.creatorCommissionRule.count(),
    earnings: await prisma.creatorEarning.count(),
    wallets: await prisma.creatorWallet.count(),
    walletTxns: await prisma.creatorWalletTransaction.count(),
    terms: await prisma.creatorTerms.count(),
    orders: await prisma.order.count(),
    products: await prisma.product.count(),
  };
}

let before = null;

try {
  // Wake the database before the first assertion, so a suspended compute
  // fails here rather than as a mystery timeout mid-suite.
  await warmUpDatabase(prisma);
  before = await census();
  console.log("Database before:", JSON.stringify(before));
  await main();
} catch (error) {
  // A driver error can arrive with an empty `message` — a dropped pooler
  // connection is the usual one — so the vendor code and meta are printed too.
  // Without them the crash report says nothing at all.
  const detail = [error?.name, error?.code, error?.message || "(no message)", JSON.stringify(error?.meta ?? null)]
    .filter(Boolean)
    .join(" | ");
  console.log("SUITE ERROR:", detail, "\n", error.stack?.split("\n").slice(0, 6).join("\n"));
  failures.push("suite crashed: " + detail);
} finally {
  // A cleanup failure must not swallow the results: it used to throw out of
  // the finally block, so a run that passed everything printed no summary at
  // all and exited non-zero with only a stack trace.
  const leftovers = await cleanup().catch((error) => {
    console.log("CLEANUP ERROR:", error?.code ?? error?.name, error?.message);
    failures.push("cleanup failed: " + (error?.message || error?.code));
    return before ?? {};
  });
  await prisma.$disconnect();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));

  // Measured against what was here before, not against zero. Asserting an
  // empty database only holds on a freshly reset one and turns every run
  // against a working database into a spurious failure — the question worth
  // asking is whether *this suite* put things back.
  const dirty = before
    ? Object.entries(before)
        .filter(([key, value]) => leftovers[key] !== value)
        .map(([key, value]) => `${key} ${value} -> ${leftovers[key]}`)
    : ["baseline never taken"];
  if (dirty.length) console.log("WARNING: database not back to how the suite found it:", dirty.join(", "));

  process.exit(failures.length || dirty.length ? 1 : 0);
}
