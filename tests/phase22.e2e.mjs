import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions } from "../src/lib/db-pool.js";

/**
 * Phase 22 — the customer's own account.
 *
 * The dashboard's boundary is the branch. This side's boundary is the
 * *person*, and it is enforced differently: there is no scope to apply,
 * only "is this yours", answered on every row. So what this proves is
 * mostly one thing from several directions — that one customer cannot
 * reach another's orders, addresses, reviews, notifications or devices,
 * and that trying is a 404 rather than a 403, because a 403 would confirm
 * the id exists and let somebody enumerate other people's orders.
 *
 * It also proves the two gates on the creator programme from the
 * customer's side: you cannot join without a completed order, and you
 * cannot film a line you did not buy.
 *
 * Start a server first:
 *   npm run test:e2e:server
 */
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });

const stamp = Date.now();
const tag = `e2e22-${stamp}`;
const emailOf = (name) => `${tag}-${name}@example.test`;
const short = String(stamp).slice(-5);
const created = { userIds: new Set(), branchIds: new Set(), orderIds: new Set(), categoryIds: new Set(), productIds: new Set(), creatorIds: new Set() };

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
const nextIp = () => `10.95.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;

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
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
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
  return { id, ...(await loginCookies(emailOf(name), password)) };
}

const rows = (res) => res.body?.data?.items ?? res.body?.data ?? [];
const ids = (res) => rows(res).map((row) => row.id);

const ADDRESS = {
  label: "Home",
  recipientName: "Ayesha Khan",
  phone: "+923001234567",
  line1: "12 Jinnah Road",
  city: "Karachi",
  state: "Sindh",
  postalCode: "75500",
};

async function main() {
  // ================= TWO CUSTOMERS =================
  const mine = await account("mine", "mine-passphrase-22");
  const theirs = await account("theirs", "theirs-passphrase-22");
  check("two customers exist", Boolean(mine.token && theirs.token));

  const branch = await prisma.branch.create({
    data: { code: `E22${short}`, name: `P22 Branch ${short}`, city: "Karachi", timezone: "Asia/Karachi" },
  });
  created.branchIds.add(branch.id);
  const category = await prisma.category.create({ data: { name: `P22 Food ${short}`, slug: `p22-food-${short}` } });
  created.categoryIds.add(category.id);
  const product = await prisma.product.create({
    data: { name: `P22 Burger ${short}`, slug: `p22-burger-${short}`, categoryId: category.id },
  });
  created.productIds.add(product.id);

  const orderFor = async (userId, label) => {
    const order = await prisma.order.create({
      data: {
        orderNumber: `P22-${label}-${short}`,
        branchId: branch.id,
        userId,
        status: "COMPLETED",
        paymentState: "PAID",
        grandTotal: 1200,
        subtotal: 1200,
        completedAt: new Date(),
      },
    });
    created.orderIds.add(order.id);
    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: product.id,
        nameSnapshot: `P22 Burger ${short}`,
        quantity: 1,
        unitPrice: 1200,
        lineTotal: 1200,
      },
    });
    return { order, item };
  };

  const ourOrder = await orderFor(mine.id, "mine");
  const theirOrder = await orderFor(theirs.id, "theirs");

  // ================= ORDERS ARE PERSONAL =================
  const myOrders = await api("/me/orders?limit=50", { token: mine.token });
  check("a customer can list their orders", myOrders.status === 200, myOrders.body?.error);
  check("their own order is listed", ids(myOrders).includes(ourOrder.order.id), { listed: ids(myOrders).length });
  check("another customer's order is NOT listed", !ids(myOrders).includes(theirOrder.order.id), {
    leaked: theirOrder.order.id,
  });

  const theirOrderDirect = await api(`/me/orders/${theirOrder.order.id}`, { token: mine.token });
  // 404, not 403: a 403 would confirm the id is real and let somebody walk
  // the id space looking for other people's orders.
  check("another customer's order is a 404 by direct id", theirOrderDirect.status === 404, { status: theirOrderDirect.status });
  const ownOrderDirect = await api(`/me/orders/${ourOrder.order.id}`, { token: mine.token });
  check("their own order opens", ownOrderDirect.status === 200, ownOrderDirect.body?.error);

  const cancelTheirs = await api(`/me/orders/${theirOrder.order.id}/cancel`, {
    method: "POST",
    token: mine.token,
    body: { reason: "P22 should not be possible" },
  });
  check("nor can it be cancelled", cancelTheirs.status === 404, { status: cancelTheirs.status });

  // ================= ADDRESSES =================
  const addressCreate = await api("/addresses", { method: "POST", token: mine.token, body: ADDRESS });
  check("an address can be saved", addressCreate.status === 201, addressCreate.body?.error);
  const addressId = addressCreate.body?.data?.id;

  // The form's own rules, proved against the API rather than asserted in a
  // unit test alone: these are the fields it refuses.
  for (const [label, body] of [
    ["no state", { ...ADDRESS, state: undefined }],
    ["no postal code", { ...ADDRESS, postalCode: undefined }],
    ["a one-character street", { ...ADDRESS, line1: "x" }],
  ]) {
    const bad = await api("/addresses", { method: "POST", token: mine.token, body });
    check(`an address with ${label} is refused`, bad.status === 400, { status: bad.status });
  }

  const theirAddress = await api("/addresses", { method: "POST", token: theirs.token, body: { ...ADDRESS, label: "Theirs" } });
  const theirAddressId = theirAddress.body?.data?.id;

  const myAddresses = await api("/addresses", { token: mine.token });
  check("only their own addresses are listed", !ids(myAddresses).includes(theirAddressId), { leaked: theirAddressId });

  const editTheirs = await api(`/addresses/${theirAddressId}`, { method: "PATCH", token: mine.token, body: { city: "Lahore" } });
  check("another customer's address cannot be edited", editTheirs.status === 404, { status: editTheirs.status });

  const makeDefault = await api(`/addresses/${addressId}/default`, { method: "POST", token: mine.token });
  check("an address can be made the default", makeDefault.status === 200 || makeDefault.status === 204, makeDefault.body?.error);

  // ================= REVIEWS =================
  const review = await api("/me/reviews", {
    method: "POST",
    token: mine.token,
    body: { orderId: ourOrder.order.id, productId: product.id, rating: 5, comment: "P22 good" },
  });
  check("a delivered order can be reviewed", review.status === 201, review.body?.error);

  const reviewTheirs = await api("/me/reviews", {
    method: "POST",
    token: mine.token,
    body: { orderId: theirOrder.order.id, productId: product.id, rating: 1 },
  });
  check("an order somebody else bought cannot be reviewed", reviewTheirs.status === 404, { status: reviewTheirs.status });

  const twice = await api("/me/reviews", {
    method: "POST",
    token: mine.token,
    body: { orderId: ourOrder.order.id, productId: product.id, rating: 3 },
  });
  check("the same thing cannot be reviewed twice", twice.status === 409 || twice.status === 400, { status: twice.status });

  const myReviews = await api("/me/reviews", { token: mine.token });
  check("their review is listed back to them", rows(myReviews).length >= 1, { count: rows(myReviews).length });

  // ================= PROFILE =================
  const rename = await api("/me", { method: "PATCH", token: mine.token, body: { name: `P22 Renamed ${short}` } });
  check("a customer can change their own name", rename.status === 200, rename.body?.error);

  const empty = await api("/me", { method: "PATCH", token: mine.token, body: {} });
  check("an empty profile update is refused", empty.status === 400, { status: empty.status });

  const wrongPassword = await api("/auth/password/change", {
    method: "POST",
    token: mine.token,
    body: { currentPassword: "not-the-password", newPassword: "a-new-passphrase-22", client: "WEB" },
  });
  check("changing a password needs the current one", wrongPassword.status === 400 || wrongPassword.status === 401, {
    status: wrongPassword.status,
  });

  // ================= NOTIFICATIONS AND DEVICES =================
  await prisma.notification.create({
    data: { userId: mine.id, type: "ORDER_UPDATE", title: `P22 note ${short}`, body: "Your order is on its way." },
  });
  await prisma.notification.create({
    data: { userId: theirs.id, type: "ORDER_UPDATE", title: `P22 theirs ${short}`, body: "Not yours." },
  });

  const notes = await api("/me/notifications?limit=50", { token: mine.token });
  const titles = rows(notes).map((row) => row.title);
  check("a customer sees their own notifications", titles.includes(`P22 note ${short}`), { titles: titles.length });
  check("and not somebody else's", !titles.includes(`P22 theirs ${short}`), { leaked: `P22 theirs ${short}` });

  const markRead = await api("/me/notifications/read", { method: "POST", token: mine.token, body: {} });
  check("they can mark everything read", markRead.status === 200, markRead.body?.error);
  const stillUnread = await prisma.notification.count({ where: { userId: theirs.id, readAt: null } });
  check("which does not touch anybody else's", stillUnread === 1, { stillUnread });

  const devices = await api("/me/devices", { token: mine.token });
  check("the device list is readable", devices.status === 200, devices.body?.error);

  // ================= THE CREATOR GATES =================
  const noOrderYet = await account("fresh", "fresh-passphrase-22");
  const eligibility = await api("/me/creator/eligibility", { token: noOrderYet.token });
  check("somebody with no completed order is not eligible", eligibility.body?.data?.eligible === false, eligibility.body?.data);
  check("and is told why", eligibility.body?.data?.reason === "NO_COMPLETED_ORDER", eligibility.body?.data);

  const earlyJoin = await api("/me/creator", {
    method: "POST",
    token: noOrderYet.token,
    body: { displayName: "Too early", acceptTerms: true },
  });
  check("and cannot join anyway", earlyJoin.status >= 400, { status: earlyJoin.status });

  const canJoin = await api("/me/creator/eligibility", { token: mine.token });
  check("somebody with a completed order is eligible", canJoin.body?.data?.eligible === true, canJoin.body?.data);

  await prisma.creatorTerms.create({
    data: { version: `v-p22-${short}`, title: "P22 terms", content: "Be nice.", isCurrent: true },
  });

  const join = await api("/me/creator", {
    method: "POST",
    token: mine.token,
    body: { displayName: `P22 Creator ${short}`, acceptTerms: true },
  });
  check("they can join the programme", join.status === 201 || join.status === 200, join.body?.error);
  const creatorId = join.body?.data?.id ?? (await prisma.creatorProfile.findUnique({ where: { userId: mine.id }, select: { id: true } }))?.id;
  if (creatorId) created.creatorIds.add(creatorId);

  // A creator may only film a line they actually bought.
  const filmTheirs = await api("/me/creator/videos", {
    method: "POST",
    token: mine.token,
    body: { orderItemId: theirOrder.item.id },
  });
  check("a line somebody else bought cannot be filmed", filmTheirs.status === 404 || filmTheirs.status === 403, {
    status: filmTheirs.status,
  });

  const filmOwn = await api("/me/creator/videos", {
    method: "POST",
    token: mine.token,
    body: { orderItemId: ourOrder.item.id, caption: "P22" },
  });
  check("their own line can be filmed", filmOwn.status === 201, filmOwn.body?.error);

  // The gap this phase was written after finding: a creator may make a video
  // record but could not upload the file, because the role lacked
  // `media.upload`. Phase 13 never caught it — it fabricates the asset URL.
  const ticket = await api("/media/uploads", {
    method: "POST",
    token: mine.token,
    body: { mimeType: "video/mp4", sizeBytes: 1024 },
  });
  check("a creator may actually upload a video file", ticket.status === 200 || ticket.status === 201, {
    status: ticket.status,
    body: ticket.body?.error,
  });

  // ================= THE SCREENS =================
  const freshLogin = await loginCookies(emailOf("mine"), "mine-passphrase-22");
  for (const path of [
    "/account",
    "/account/addresses",
    "/account/reviews",
    "/account/profile",
    "/account/notifications",
    "/account/devices",
    "/account/creator",
    "/account/creator/videos",
    `/account/orders/${ourOrder.order.id}`,
  ]) {
    const res = await page(path, freshLogin.cookie);
    check(`${path} renders`, res.status === 200, { status: res.status, location: res.location });
  }

  const theirOrderPage = await page(`/account/orders/${theirOrder.order.id}`, freshLogin.cookie);
  check("another customer's order page is not found", theirOrderPage.status === 404, { status: theirOrderPage.status });

  const ordersPage = await page("/account", freshLogin.cookie);
  check("the orders page does not name another customer's order", !ordersPage.html.includes(`P22-theirs-${short}`), {
    leaked: `P22-theirs-${short}`,
  });
  check("while it does name their own", ordersPage.html.includes(`P22-mine-${short}`), { missing: `P22-mine-${short}` });

  // Somebody who never joined sees the invitation, not the studio.
  const fresh = await loginCookies(emailOf("fresh"), "fresh-passphrase-22");
  const studio = await page("/account/creator", fresh.cookie);
  check("a non-creator still reaches the studio page", studio.status === 200, { status: studio.status });
  check("and is told what unlocks it", /one order delivered|not taking new people/i.test(studio.html), {
    hint: "expected the eligibility sentence",
  });
}

async function cleanup() {
  const userIds = [...created.userIds];
  const creatorIds = [...created.creatorIds];
  const orderIds = [...created.orderIds];

  await prisma.creatorVideoAsset.deleteMany({ where: { video: { creatorId: { in: creatorIds } } } });
  await prisma.creatorVideoReview.deleteMany({ where: { video: { creatorId: { in: creatorIds } } } });
  await prisma.creatorVideo.deleteMany({ where: { creatorId: { in: creatorIds } } });
  await prisma.creatorTermsAcceptance.deleteMany({ where: { creatorId: { in: creatorIds } } });
  await prisma.creatorWalletTransaction.deleteMany({ where: { wallet: { creatorId: { in: creatorIds } } } });
  await prisma.creatorWallet.deleteMany({ where: { creatorId: { in: creatorIds } } });
  await prisma.creatorProfile.deleteMany({ where: { id: { in: creatorIds } } });
  await prisma.creatorTerms.deleteMany({ where: { version: { contains: String(short) } } });

  await prisma.review.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.orderItemModifier.deleteMany({ where: { orderItem: { orderId: { in: orderIds } } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderStatusEvent.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.productVariant.deleteMany({ where: { productId: { in: [...created.productIds] } } });
  await prisma.product.deleteMany({ where: { id: { in: [...created.productIds] } } });
  await prisma.category.deleteMany({ where: { id: { in: [...created.categoryIds] } } });

  await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { branchId: { in: [...created.branchIds] } }] } });
  await prisma.userRoleAssignment.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.credentialToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.userPermissionOverride.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branchHour.deleteMany({ where: { branchId: { in: [...created.branchIds] } } });
  await prisma.branch.deleteMany({ where: { id: { in: [...created.branchIds] } } });

  console.log("REMAINING", JSON.stringify({
    users: await prisma.user.count(),
    orders: await prisma.order.count(),
    creators: await prisma.creatorProfile.count(),
    branches: await prisma.branch.count(),
  }));
}

try {
  await main();
} catch (error) {
  console.log("SUITE ERROR:", error.name, "|", error.message, "|", error.stack?.split("\n")[1]?.trim());
  failures.push("suite crashed: " + error.message);
} finally {
  await cleanup().catch((error) => console.log("CLEANUP ERROR:", error?.code ?? error?.name, error.message));
  await prisma.$disconnect();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
