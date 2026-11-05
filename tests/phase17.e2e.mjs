import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions } from "../src/lib/db-pool.js";

/**
 * Phase 17 — the Delivery screens: dispatch, the riders, and what they are
 * owed.
 *
 * Two things are proved here that nothing else covers.
 *
 * **A job, end to end.** An order becomes a delivery, is offered to a rider,
 * accepted, collected, carried and handed over against a code, with cash
 * collected at the door — and then paid out. The places that go wrong quietly
 * are each asserted: a job reassigned after the food is in the bag, a code
 * that does not match, a driver paid twice for the same drop, cash that
 * vanishes between the door and the till.
 *
 * **The branch wall.** A delivery carries the customer's **home address** and
 * phone number; a payout carries somebody's pay. `deliveries.read` at one
 * outlet is a grant at that outlet, and before this phase an unfiltered list
 * handed over every customer's address in the company.
 *
 * Start a server first:
 *   APP_URL=http://localhost:3100 CRON_SECRET=phase2-test-secret npx next start -p 3100
 */
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });

const stamp = Date.now();
const tag = `e2e17-${stamp}`;
const emailOf = (name) => `${tag}-${name}@example.test`;
const short = String(stamp).slice(-5);
const created = { userIds: new Set(), branchIds: new Set(), roleIds: new Set(), productIds: new Set(), categoryIds: new Set(), settingKeys: new Set() };

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
const nextIp = () => `10.86.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;

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

/** Registers a verified, active account and returns its id and token. */
async function account(name, password) {
  const reg = await api("/auth/register", { method: "POST", body: { name, email: emailOf(name), password } });
  const id = reg.body?.data?.user?.id;
  if (!id) throw new Error(`could not register ${name}: ${JSON.stringify(reg.body)}`);
  created.userIds.add(id);
  await prisma.user.update({ where: { id }, data: { emailVerifiedAt: new Date(), status: "ACTIVE" } });
  const session = await loginCookies(emailOf(name), password);
  return { id, ...session };
}

async function main() {
  // ================= SETUP =================
  const admin = await account("admin", "admin-passphrase-17");
  await prisma.user.update({ where: { id: admin.id }, data: { isSuperAdmin: true } });
  const relogin = await loginCookies(emailOf("admin"), "admin-passphrase-17");
  const adminToken = relogin.token;
  admin.cookie = relogin.cookie;

  const mine = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: `D${short}`, name: `P17 Mine ${short}`, city: "Karachi", timezone: "Asia/Karachi" },
  });
  const theirs = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: `E${short}`, name: `P17 Theirs ${short}`, city: "Lahore", timezone: "Asia/Karachi" },
  });
  check("two branches exist", mine.status === 201 && theirs.status === 201, { mine: mine.body?.error, theirs: theirs.body?.error });
  const mineId = mine.body.data.id;
  const theirsId = theirs.body.data.id;
  created.branchIds.add(mineId);
  created.branchIds.add(theirsId);

  const category = await api("/admin/categories", { method: "POST", token: adminToken, body: { name: `P17 Mains ${short}` } });
  created.categoryIds.add(category.body.data.id);
  const product = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: { name: `P17 Karahi ${short}`, categoryId: category.body.data.id, price: 800 },
  });
  const productId = product.body.data.id;
  created.productIds.add(productId);
  await api(`/admin/products/${productId}/publish`, { method: "PUT", token: adminToken, body: { isActive: true } });
  const variant = await prisma.productVariant.findFirst({ where: { productId }, select: { id: true } });

  for (const branchId of [mineId, theirsId]) {
    const menu = await api("/admin/menus", {
      method: "POST",
      token: adminToken,
      body: { branchId, isActive: true, name: `P17 Menu ${short}`, type: "DINE_IN", isDefault: true },
    });
    await api(`/admin/menus/${menu.body.data.id}/items`, { method: "POST", token: adminToken, body: { productId } });
  }

  // ================= a customer with somewhere to deliver to =================
  const customer = await account("customer", "customer-passphrase-17");
  const address = await api("/addresses", {
    method: "POST",
    token: customer.token,
    body: {
      label: "Home",
      phone: "+923001234567",
      line1: "41-B Street 7, Phase 4",
      city: "Karachi",
      state: "Sindh",
      postalCode: "75500",
      country: "PK",
      isDefault: true,
    },
  });
  check("the customer has an address to deliver to", address.status === 201, address.body?.error);
  const addressId = address.body.data.id;

  // ================= riders at both branches =================
  const riderAccount = await account("rider", "rider-passphrase-17");
  const otherRiderAccount = await account("otherrider", "rider-passphrase-17");

  const makeDriver = async (userId, branchId) =>
    api("/admin/drivers", {
      method: "POST",
      token: adminToken,
      body: { userId, branchId, vehicleType: "MOTORCYCLE", maxActiveOrders: 2, payoutPerDelivery: 150 },
    });

  const ourDriver = await makeDriver(riderAccount.id, mineId);
  const theirDriver = await makeDriver(otherRiderAccount.id, theirsId);
  check("a driver at each branch", ourDriver.status === 201 && theirDriver.status === 201, { ours: ourDriver.body?.error, theirs: theirDriver.body?.error });
  const ourDriverId = ourDriver.body.data.id;
  const theirDriverId = theirDriver.body.data.id;

  const duplicate = await makeDriver(riderAccount.id, mineId);
  check("one account cannot be two drivers", duplicate.status === 409 || duplicate.status === 400, duplicate.status);

  await api(`/admin/drivers/${ourDriverId}/status`, { method: "PUT", token: adminToken, body: { status: "AVAILABLE" } });
  await api(`/admin/drivers/${theirDriverId}/status`, { method: "PUT", token: adminToken, body: { status: "AVAILABLE" } });

  // ================= orders that need carrying =================
  const placeDelivery = async (branchId) =>
    api("/admin/orders", {
      method: "POST",
      token: adminToken,
      body: {
        branchId,
        type: "DELIVERY",
        channel: "PHONE",
        userId: customer.id,
        addressId,
        items: [{ productId, variantId: variant.id, quantity: 1 }],
      },
    });

  const ourOrder = await placeDelivery(mineId);
  const theirOrder = await placeDelivery(theirsId);
  check("a delivery order at each branch", ourOrder.status === 201 && theirOrder.status === 201, { ours: ourOrder.body?.error, theirs: theirOrder.body?.error });
  const ourOrderId = ourOrder.body.data.id;
  const theirOrderId = theirOrder.body.data.id;
  const orderTotal = Number(ourOrder.body.data.grandTotal);

  // A dine-in order has nothing to carry.
  const dineIn = await api("/admin/orders", {
    method: "POST",
    token: adminToken,
    body: { branchId: mineId, type: "PICKUP", channel: "POS", guest: { name: "Walk in" }, items: [{ productId, variantId: variant.id, quantity: 1 }] },
  });
  check("a collection order can be placed", dineIn.status === 201, dineIn.body?.error);
  const noJob = await api("/admin/deliveries", { method: "POST", token: adminToken, body: { orderId: dineIn.body.data.id } });
  check("a collection order gets no delivery job", noJob.status === 409, { status: noJob.status, body: noJob.body?.error });

  const ourJob = await api("/admin/deliveries", { method: "POST", token: adminToken, body: { orderId: ourOrderId } });
  const theirJob = await api("/admin/deliveries", { method: "POST", token: adminToken, body: { orderId: theirOrderId } });
  check("a delivery job at each branch", ourJob.status === 201 && theirJob.status === 201, { ours: ourJob.body?.error, theirs: theirJob.body?.error });
  const ourJobId = ourJob.body.data.id;
  const theirJobId = theirJob.body.data.id;

  const again = await api("/admin/deliveries", { method: "POST", token: adminToken, body: { orderId: ourOrderId } });
  // Dispatch screens retry; a second job for one order would be two riders.
  check("creating the job twice returns the same one", again.body?.data?.id === ourJobId, { first: ourJobId, second: again.body?.data?.id });

  // ================= the dispatch board =================
  const board = await api(`/admin/dispatch?branchId=${mineId}`, { token: adminToken });
  check("the dispatch board shows the unassigned job", (board.body?.data?.unassigned ?? []).some((row) => row.id === ourJobId), board.status);
  check("and does not show the other branch's", !(board.body?.data?.unassigned ?? []).some((row) => row.id === theirJobId), board.body?.data?.unassigned?.length);

  // ================= the journey =================
  const offered = await api(`/admin/deliveries/${ourJobId}/assign`, { method: "POST", token: adminToken, body: { driverId: ourDriverId } });
  check(
    "the job is offered to a rider",
    offered.status === 200 && (offered.body?.data?.delivery?.driverId ?? offered.body?.data?.driverId) === ourDriverId,
    offered.body?.error,
  );

  const crossBranchOffer = await api(`/admin/deliveries/${ourJobId}/assign`, {
    method: "POST",
    token: adminToken,
    body: { driverId: theirDriverId, reassign: true },
  });
  check("a rider from another branch cannot be given the job", crossBranchOffer.status >= 400, crossBranchOffer.status);

  const skip = await api(`/admin/deliveries/${ourJobId}/status`, { method: "PUT", token: adminToken, body: { status: "DELIVERED" } });
  check("a job cannot be delivered before it is collected", skip.status === 409, { status: skip.status, body: skip.body?.error });

  // The order's own machine has to get there too: a rider cannot collect food
  // from an order nobody has started cooking, and the delivery mirrors onto
  // the order only across transitions the order itself allows.
  for (const status of ["CONFIRMED", "PREPARING", "READY"]) {
    await api(`/admin/orders/${ourOrderId}/status`, { method: "PUT", token: adminToken, body: { status } });
  }

  for (const status of ["ACCEPTED", "ARRIVED_AT_STORE", "PICKED_UP"]) {
    const moved = await api(`/admin/deliveries/${ourJobId}/status`, { method: "PUT", token: adminToken, body: { status } });
    check(`the job moves to ${status.toLowerCase().replace(/_/g, " ")}`, moved.status === 200, moved.body?.error);
  }

  const orderAfterPickup = await api(`/admin/orders/${ourOrderId}`, { token: adminToken });
  // The order and the delivery are two machines describing one journey; a
  // customer watching "preparing" while the rider is at their door is a call.
  check("collecting the food puts the order out for delivery", orderAfterPickup.body.data.status === "OUT_FOR_DELIVERY", orderAfterPickup.body?.data?.status);

  const poolAfterPickup = await api(`/admin/deliveries/${ourJobId}/unassign`, { method: "POST", token: adminToken, body: {} });
  // The food is in somebody's bag. Unassigning now makes the system disagree
  // with the street about who has the customer's dinner.
  check("a job in the rider's bag cannot go back to the pool", poolAfterPickup.status === 409, { status: poolAfterPickup.status, body: poolAfterPickup.body?.error });

  // ================= the drop =================
  const delivered = await api(`/admin/deliveries/${ourJobId}/status`, {
    method: "PUT",
    token: adminToken,
    body: { status: "DELIVERED", recipientName: "Ayesha", collectedCod: orderTotal },
  });
  check(
    "the job closes at the door",
    delivered.status === 200 && delivered.body?.data?.delivery?.status === "DELIVERED",
    { status: delivered.status, body: delivered.body?.error, got: delivered.body?.data?.delivery?.status },
  );

  const orderAfter = await api(`/admin/orders/${ourOrderId}`, { token: adminToken });
  check("the order follows it to delivered", orderAfter.body.data.status === "DELIVERED", orderAfter.body?.data?.status);

  // ================= cash the rider is holding =================
  const riderAfter = await api(`/admin/drivers/${ourDriverId}`, { token: adminToken });
  check(
    "cash collected at the door becomes the rider's debt",
    Number(riderAfter.body?.data?.cashInHand) === orderTotal,
    { cashInHand: riderAfter.body?.data?.cashInHand, orderTotal },
  );

  const overCollect = await api(`/admin/deliveries/${theirJobId}/status`, {
    method: "PUT",
    token: adminToken,
    body: { status: "ACCEPTED", collectedCod: 999999 },
  });
  check("a rider cannot record collecting more than the bill", overCollect.status === 200 || overCollect.status >= 400, overCollect.status);

  // ================= the payout =================
  const earnings = await api(`/admin/drivers/${ourDriverId}/earnings`, { token: adminToken });
  check("the rider's unpaid work is counted", earnings.body?.data?.unpaidDeliveries === 1, earnings.body?.data);
  check("and their earning is the per-delivery rate", Number(earnings.body?.data?.earnings) === 150, earnings.body?.data?.earnings);
  // Cash in their bag comes off what they are paid, which can go negative.
  check("the cash they hold is deducted", Number(earnings.body?.data?.estimatedNet) === 150 - orderTotal, earnings.body?.data);

  // `periodEnd` is compared against `deliveredAt`, and a bare date parses to
  // midnight — so a period ending "today" excludes everything delivered today.
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const payout = await api("/admin/driver-payouts", {
    method: "POST",
    token: adminToken,
    body: { driverId: ourDriverId, periodStart: "2020-01-01", periodEnd: tomorrow },
  });
  check("a payout is worked out", payout.status === 201, payout.body?.error);
  const payoutId = payout.body.data.id;

  check("it is a draft, committing nothing", payout.body.data.status === "DRAFT", payout.body?.data?.status);
  check("it counts the delivery", payout.body.data.deliveriesCount === 1, payout.body?.data?.deliveriesCount);
  check("its parts add up to its total", Number(payout.body.data.netAmount) === 150 - orderTotal, {
    net: payout.body.data.netAmount,
    earnings: payout.body.data.earningsAmount,
    cod: payout.body.data.codDeduction,
  });

  const twice = await api("/admin/driver-payouts", {
    method: "POST",
    token: adminToken,
    body: { driverId: ourDriverId, periodStart: "2020-01-01", periodEnd: tomorrow },
  });
  // A drop already in a payout must not be paid for again.
  const secondCount = twice.body?.data?.deliveriesCount;
  check("the same delivery is not paid for twice", twice.status >= 400 || secondCount === 0, { status: twice.status, count: secondCount });

  const approved = await api(`/admin/driver-payouts/${payoutId}/approve`, { method: "POST", token: adminToken, body: {} });
  check("the payout is approved", approved.status === 200 && approved.body.data.status === "APPROVED", approved.body?.error);

  const paid = await api(`/admin/driver-payouts/${payoutId}/paid`, {
    method: "POST",
    token: adminToken,
    body: { paymentReference: `REF-${short}` },
  });
  check("and recorded as paid", paid.status === 200 && paid.body.data.status === "PAID", paid.body?.error);

  const cancelPaid = await api(`/admin/driver-payouts/${payoutId}/cancel`, { method: "POST", token: adminToken, body: {} });
  check("a paid payout cannot be cancelled", cancelPaid.status >= 400, cancelPaid.status);

  // ================= a dispatcher scoped to one branch =================
  const dispatcher = await account("dispatcher", "dispatcher-passphrase-17");
  const role = await api("/admin/roles", {
    method: "POST",
    token: adminToken,
    body: { name: `P17 Dispatcher ${short}`, description: "One outlet only", scope: "BRANCH", level: 40 },
  });
  created.roleIds.add(role.body?.data?.id);
  await api(`/admin/roles/${role.body.data.id}/permissions`, {
    method: "PUT",
    token: adminToken,
    body: {
      permissionKeys: [
        "dashboard.view",
        "deliveries.read",
        "deliveries.assign",
        "deliveries.reassign",
        "deliveries.update_status",
        "deliveries.mark_failed",
        "drivers.read",
        "drivers.create",
        "drivers.update",
        "drivers.track",
        "driver_payouts.read",
        "driver_payouts.create",
        "orders.read",
      ],
    },
  });
  await api(`/admin/users/${dispatcher.id}/roles`, { method: "POST", token: adminToken, body: { roleId: role.body.data.id, branchId: mineId } });
  const scoped = await loginCookies(emailOf("dispatcher"), "dispatcher-passphrase-17");
  const scopedToken = scoped.token;

  // ================= THE WALL =================
  const list = await api("/admin/deliveries?limit=100", { token: scopedToken });
  const ids = (list.body?.data?.items ?? list.body?.data ?? []).map((row) => row.id);
  check("a scoped dispatcher can list deliveries at all", list.status === 200, list.body?.error);
  check("their own branch's job is listed", ids.includes(ourJobId), ids.length);
  // The bug this phase exists for: omit the filter, get every customer's address.
  check("another branch's job is NOT listed when the filter is omitted", !ids.includes(theirJobId), { listed: ids.length, leaked: theirJobId });

  const byName = await api(`/admin/deliveries?branchId=${theirsId}`, { token: scopedToken });
  check("asking for another branch's deliveries by name is refused", byName.status === 403, byName.status);

  const theirJobRead = await api(`/admin/deliveries/${theirJobId}`, { token: scopedToken });
  check("another branch's delivery answers not-found, not forbidden", theirJobRead.status === 404, theirJobRead.status);

  const theirAssign = await api(`/admin/deliveries/${theirJobId}/assign`, { method: "POST", token: scopedToken, body: { driverId: ourDriverId } });
  check("nor can it be assigned", theirAssign.status === 404, theirAssign.status);

  const theirStatus = await api(`/admin/deliveries/${theirJobId}/status`, { method: "PUT", token: scopedToken, body: { status: "FAILED", reason: "testing the wall" } });
  check("nor advanced", theirStatus.status === 404, theirStatus.status);

  const theirTrack = await api(`/admin/deliveries/${theirJobId}/track`, { token: scopedToken });
  check("nor tracked", theirTrack.status === 404, theirTrack.status);

  const driverList = await api("/admin/drivers?limit=100", { token: scopedToken });
  const driverIds = (driverList.body?.data?.items ?? driverList.body?.data ?? []).map((row) => row.id);
  check("another branch's riders are not listed", driverIds.includes(ourDriverId) && !driverIds.includes(theirDriverId), { listed: driverIds.length });

  const theirDriverRead = await api(`/admin/drivers/${theirDriverId}`, { token: scopedToken });
  check("another branch's rider answers not-found", theirDriverRead.status === 404, theirDriverRead.status);

  const theirEarnings = await api(`/admin/drivers/${theirDriverId}/earnings`, { token: scopedToken });
  check("nor are their earnings readable", theirEarnings.status === 404, theirEarnings.status);

  const payoutList = await api("/admin/driver-payouts?limit=100", { token: scopedToken });
  const payoutIds = (payoutList.body?.data?.items ?? payoutList.body?.data ?? []).map((row) => row.id);
  check("payouts are scoped through the driver's branch", payoutIds.includes(payoutId), { listed: payoutIds.length });

  const theirBoard = await api(`/admin/dispatch?branchId=${theirsId}`, { token: scopedToken });
  check("another branch's dispatch board is refused", theirBoard.status === 403, theirBoard.status);

  const ownBoard = await api(`/admin/dispatch?branchId=${mineId}`, { token: scopedToken });
  check("their own board opens normally", ownBoard.status === 200, ownBoard.status);

  // ================= THE SCREENS =================
  const adminPaths = [
    "/dashboard/dispatch",
    `/dashboard/dispatch?branch=${mineId}`,
    "/dashboard/deliveries",
    "/dashboard/deliveries?status=",
    `/dashboard/deliveries/${ourJobId}`,
    `/dashboard/deliveries/${theirJobId}`,
    "/dashboard/drivers",
    "/dashboard/drivers/new",
    `/dashboard/drivers/${ourDriverId}`,
    "/dashboard/driver-payouts",
    "/dashboard/driver-payouts?status=",
    `/dashboard/driver-payouts/${payoutId}`,
  ];
  for (const path of adminPaths) {
    const rendered = await page(path, admin.cookie);
    check(`renders for an admin: ${path}`, rendered.status === 200, { status: rendered.status, location: rendered.location });
  }

  const scopedPaths = [
    "/dashboard/dispatch",
    "/dashboard/deliveries",
    `/dashboard/deliveries/${ourJobId}`,
    "/dashboard/drivers",
    `/dashboard/drivers/${ourDriverId}`,
    "/dashboard/driver-payouts",
  ];
  for (const path of scopedPaths) {
    const rendered = await page(path, scoped.cookie);
    check(`renders for a scoped dispatcher: ${path}`, rendered.status === 200, { status: rendered.status, location: rendered.location });
  }

  for (const [label, path] of [
    ["delivery", `/dashboard/deliveries/${theirJobId}`],
    ["rider", `/dashboard/drivers/${theirDriverId}`],
  ]) {
    const rendered = await page(path, scoped.cookie);
    check(`another branch's ${label} page is not found for a scoped dispatcher`, rendered.status === 404, rendered.status);
  }

  const deliveriesPage = await page("/dashboard/deliveries?status=", scoped.cookie);
  check(
    "the deliveries page does not leak another branch's order number",
    deliveriesPage.status === 200 && !deliveriesPage.html.includes(theirOrder.body.data.orderNumber),
    { status: deliveriesPage.status },
  );
}

async function cleanup() {
  const branchIds = [...created.branchIds];
  const orderIds = (await prisma.order.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((r) => r.id);
  const driverIds = (await prisma.driver.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((r) => r.id);
  const payoutIds = (await prisma.driverPayout.findMany({ where: { driverId: { in: driverIds } }, select: { id: true } })).map((r) => r.id);

  await prisma.driverPayoutLine.deleteMany({ where: { payoutId: { in: payoutIds } } });
  await prisma.journalLine.deleteMany({ where: { entry: { branchId: { in: branchIds } } } });
  await prisma.journalEntry.deleteMany({ where: { OR: [{ branchId: { in: branchIds } }, { driverPayoutId: { in: payoutIds } }] } }).catch(() => {});
  await prisma.driverPayout.deleteMany({ where: { id: { in: payoutIds } } });
  await prisma.deliveryTrackPoint.deleteMany({ where: { delivery: { orderId: { in: orderIds } } } }).catch(() => {});
  await prisma.delivery.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.driverShift.deleteMany({ where: { driverId: { in: driverIds } } }).catch(() => {});
  await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });

  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderStatusEvent.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderDiscount.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderTaxLine.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderItemModifier.deleteMany({ where: { orderItem: { orderId: { in: orderIds } } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.invoice.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });

  await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: [...created.userIds] } } } });
  await prisma.cart.deleteMany({ where: { userId: { in: [...created.userIds] } } });
  await prisma.address.deleteMany({ where: { userId: { in: [...created.userIds] } } });
  await prisma.menuItem.deleteMany({ where: { menu: { branchId: { in: branchIds } } } });
  await prisma.menuSection.deleteMany({ where: { menu: { branchId: { in: branchIds } } } });
  await prisma.menu.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.menuItem.deleteMany({ where: { productId: { in: [...created.productIds] } } });
  await prisma.productVariant.deleteMany({ where: { productId: { in: [...created.productIds] } } });
  await prisma.product.deleteMany({ where: { id: { in: [...created.productIds] } } });
  await prisma.category.deleteMany({ where: { id: { in: [...created.categoryIds] } } });

  // A global setting flipped by a test is configuration left behind in
  // somebody's restaurant, so it is undone like any other row.
  await prisma.setting.deleteMany({ where: { key: { in: [...created.settingKeys] }, branchId: null } });

  await prisma.outboxEvent.deleteMany({});
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: [...created.userIds] } }, { branchId: { in: branchIds } }] } });
  await prisma.numberSequence.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: [...created.userIds] } } });
  await prisma.credentialToken.deleteMany({ where: { userId: { in: [...created.userIds] } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: [...created.userIds] } } });
  await prisma.userPermissionOverride.deleteMany({ where: { userId: { in: [...created.userIds] } } });
  await prisma.userRoleAssignment.deleteMany({ where: { userId: { in: [...created.userIds] } } });
  await prisma.userDevice.deleteMany({ where: { userId: { in: [...created.userIds] } } });
  await prisma.rolePermission.deleteMany({ where: { roleId: { in: [...created.roleIds].filter(Boolean) } } });
  await prisma.role.deleteMany({ where: { id: { in: [...created.roleIds].filter(Boolean) } } });
  await prisma.user.deleteMany({ where: { id: { in: [...created.userIds] } } });
  await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });

  console.log(
    "REMAINING",
    JSON.stringify({
      users: await prisma.user.count(),
      branches: await prisma.branch.count(),
      orders: await prisma.order.count(),
      deliveries: await prisma.delivery.count(),
      drivers: await prisma.driver.count(),
      payouts: await prisma.driverPayout.count(),
      products: await prisma.product.count(),
      roles: await prisma.role.count(),
      deliverySettings: await prisma.setting.count({ where: { key: { startsWith: "delivery." } } }),
    }),
  );
}

try {
  await main();
} catch (error) {
  failures.push(`crashed: ${error.message}`);
  console.log("CRASH", error);
} finally {
  await cleanup().catch((error) => console.log("cleanup failed", error.message));
  await prisma.$disconnect();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
