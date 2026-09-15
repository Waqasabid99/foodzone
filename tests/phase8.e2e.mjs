import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions, warmUpDatabase } from "../src/lib/db-pool.js";

/**
 * Phase 8 — Delivery, end to end.
 *
 * Start a server first:
 *   APP_URL=http://localhost:3100 CRON_SECRET=phase2-test-secret npx next dev -p 3100
 *
 * The sequence rules live in tests/unit.mjs, where the state machine is pure.
 * What this suite proves is everything that only exists once there are drivers,
 * money and a database: that a driver cannot touch another driver's job, that
 * COD becomes a debt the driver carries, that a handover code cannot be
 * bypassed, that concurrency limits hold, and that a payout counts each drop
 * exactly once.
 */
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });

const stamp = Date.now();
const tag = `e2e8-${stamp}`;
const emailOf = (name) => `${tag}-${name}@example.test`;
const BRANCH_CODE = `E2E8${String(stamp).slice(-5)}`;
const created = { userIds: new Set(), branchIds: new Set() };

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
const nextIp = () => `10.80.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;

async function api(pathname, { method = "GET", body, token, ip } = {}) {
  const res = await fetch(`${BASE}/api/v1${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip ?? nextIp(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
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

const num = (value) => Number(value ?? 0);

async function main() {
  // ================= SETUP =================
  const adminReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P8 Admin", email: emailOf("admin"), password: "admin-passphrase-8" },
  });
  const adminId = adminReg.body.data.user.id;
  created.userIds.add(adminId);
  await prisma.user.update({
    where: { id: adminId },
    data: { isSuperAdmin: true, status: "ACTIVE", emailVerifiedAt: new Date() },
  });
  const adminToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("admin"), password: "admin-passphrase-8" } })
  ).body.data.accessToken;

  const branch = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: BRANCH_CODE, name: "P8 Branch", city: "Karachi", timezone: "Asia/Karachi" },
  });
  const branchId = branch.body.data.id;
  created.branchIds.add(branchId);

  await api("/admin/settings", {
    method: "PUT",
    token: adminToken,
    body: {
      branchId,
      values: {
        "ordering.delivery_fee": 0,
        "ordering.packaging_fee": 0,
        "ordering.service_charge_percent": 0,
        "ordering.min_order_amount": 0,
        "delivery.driver_base_earning": 150,
      },
    },
  });
  await api("/admin/settings", {
    method: "PUT",
    token: adminToken,
    body: { values: { "ordering.prices_include_tax": true } },
  });

  const category = await api("/admin/categories", { method: "POST", token: adminToken, body: { name: `Food ${stamp}` } });
  const burger = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: { name: `Burger ${stamp}`, categoryId: category.body.data.id, price: 1000 },
  });
  const burgerId = burger.body.data.id;
  await api(`/admin/products/${burgerId}/publish`, { method: "PUT", token: adminToken, body: { isActive: true } });

  const menu = await api("/admin/menus", {
    method: "POST",
    token: adminToken,
    body: { branchId, name: `Main ${stamp}`, type: "DINE_IN", isDefault: true },
  });
  await api(`/admin/menus/${menu.body.data.id}/items`, {
    method: "POST",
    token: adminToken,
    body: { productId: burgerId },
  });

  /** A customer with a saved address, so delivery orders can be placed. */
  const custReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P8 Customer", email: emailOf("cust"), password: "customer-passphrase-8" },
  });
  const customerId = custReg.body.data.user.id;
  created.userIds.add(customerId);
  await prisma.user.update({ where: { id: customerId }, data: { emailVerifiedAt: new Date() } });
  const customerToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("cust"), password: "customer-passphrase-8" } })
  ).body.data.accessToken;

  const address = await api("/addresses", {
    method: "POST",
    token: customerToken,
    body: {
      label: "Home",
      recipientName: "P8 Customer",
      phone: "+923001234567",
      line1: "42 Test Street",
      city: "Karachi",
      state: "Sindh",
      postalCode: "75500",
    },
  });
  const addressId = address.body.data.id;
  check("setup is complete", burger.status === 201 && address.status === 201, address.body?.error);

  /** Places a delivery order for the customer and returns its id. */
  async function placeDeliveryOrder() {
    const res = await api("/admin/orders", {
      method: "POST",
      token: adminToken,
      body: {
        branchId,
        type: "DELIVERY",
        channel: "PHONE",
        items: [{ productId: burgerId, quantity: 1 }],
        userId: customerId,
        addressId,
      },
    });
    if (res.status !== 201) throw new Error(`order failed: ${JSON.stringify(res.body).slice(0, 200)}`);
    return res.body.data.id;
  }

  /**
   * Walks an order through the kitchen to READY, which is how a delivery job
   * comes to exist in production. Pickup can only move an order to
   * OUT_FOR_DELIVERY from there.
   */
  async function readyOrder(id) {
    for (const status of ["CONFIRMED", "PREPARING", "READY"]) {
      await api(`/admin/orders/${id}/status`, { method: "PUT", token: adminToken, body: { status } });
    }
  }

  const phoneOrderId = await placeDeliveryOrder();
  check("staff can take a delivery order over the phone", Boolean(phoneOrderId), { phoneOrderId });

  // ================= DRIVER ONBOARDING =================
  async function makeDriverUser(name) {
    const reg = await api("/auth/register", {
      method: "POST",
      body: { name: `P8 ${name}`, email: emailOf(name), password: `${name}-passphrase-8` },
    });
    const userId = reg.body.data.user.id;
    created.userIds.add(userId);
    await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date(), status: "ACTIVE" } });
    const token = (
      await api("/auth/login", { method: "POST", body: { email: emailOf(name), password: `${name}-passphrase-8` } })
    ).body.data.accessToken;
    return { userId, token };
  }

  const alice = await makeDriverUser("alice");
  const bob = await makeDriverUser("bob");

  const notADriver = await api("/me/driver", { token: alice.token });
  check("a user who is not a driver is told so", notADriver.status === 403, notADriver.body?.error);

  const driverA = await api("/admin/drivers", {
    method: "POST",
    token: adminToken,
    body: { userId: alice.userId, branchId, vehicleType: "MOTORCYCLE", vehicleNumber: `KHI-${String(stamp).slice(-4)}`, maxActiveOrders: 1 },
  });
  check("a driver is registered", driverA.status === 201, driverA.body);
  const driverAId = driverA.body.data.id;
  check("a new driver starts off shift", driverA.body.data.status === "OFFLINE", driverA.body?.data);

  const duplicate = await api("/admin/drivers", {
    method: "POST",
    token: adminToken,
    body: { userId: alice.userId, branchId },
  });
  check("the same user cannot be a driver twice", duplicate.status === 409, duplicate.body?.error);

  const driverB = await api("/admin/drivers", {
    method: "POST",
    token: adminToken,
    body: { userId: bob.userId, branchId, vehicleType: "CAR", maxActiveOrders: 3 },
  });
  const driverBId = driverB.body.data.id;

  const selfOnDelivery = await api("/me/driver/availability", {
    method: "PUT",
    token: alice.token,
    body: { status: "ON_DELIVERY" },
  });
  check("a driver cannot declare themselves on a delivery", selfOnDelivery.status === 400, selfOnDelivery.body?.error);

  const selfSuspend = await api("/me/driver/availability", {
    method: "PUT",
    token: alice.token,
    body: { status: "SUSPENDED" },
  });
  check("nor suspend themselves", selfSuspend.status === 400, selfSuspend.body?.error);

  // ================= SHIFTS =================
  const shift = await api("/me/driver/shift", { method: "POST", token: alice.token, body: {} });
  check("starting a shift brings the driver online", shift.status === 201, shift.body?.error);

  const driverAfterShift = await api(`/admin/drivers/${driverAId}`, { token: adminToken });
  check("and marks them available", driverAfterShift.body.data.status === "AVAILABLE", driverAfterShift.body?.data);

  const doubleShift = await api("/me/driver/shift", { method: "POST", token: alice.token, body: {} });
  check("a driver cannot open two shifts", doubleShift.status === 409, doubleShift.body?.error);

  await api("/me/driver/shift", { method: "POST", token: bob.token, body: {} });

  // ================= DISPATCH =================
  const orderId = await placeDeliveryOrder();
  await readyOrder(orderId);

  const deliveryRes = await api("/admin/deliveries", { method: "POST", token: adminToken, body: { orderId } });
  check("a delivery job is created for the order", deliveryRes.status === 201, deliveryRes.body);
  const deliveryId = deliveryRes.body.data.id;
  check("it starts unassigned", deliveryRes.body.data.status === "PENDING", deliveryRes.body?.data);
  check("the driver earning comes from settings", num(deliveryRes.body.data.driverEarning) === 150, deliveryRes.body?.data);
  check("the COD is the unpaid balance", num(deliveryRes.body.data.codAmount) === 1000, deliveryRes.body?.data);

  const again = await api("/admin/deliveries", { method: "POST", token: adminToken, body: { orderId } });
  check("creating it twice returns the same job", again.body?.data?.id === deliveryId, again.body?.data);

  const pickupOrder = await api("/admin/orders", {
    method: "POST",
    token: adminToken,
    body: { branchId, type: "DINE_IN", channel: "POS", items: [{ productId: burgerId, quantity: 1 }], guest: { name: "Walk-in" } },
  });
  const notDelivery = await api("/admin/deliveries", {
    method: "POST",
    token: adminToken,
    body: { orderId: pickupOrder.body.data.id },
  });
  check("a dine-in order has no delivery job", notDelivery.status === 409, notDelivery.body?.error);

  const board = await api(`/admin/dispatch?branchId=${branchId}`, { token: adminToken });
  check("the dispatch board shows the unassigned job", board.body.data.unassigned.some((d) => d.id === deliveryId), board.body?.data);

  const assigned = await api(`/admin/deliveries/${deliveryId}/assign`, {
    method: "POST",
    token: adminToken,
    body: { driverId: driverAId },
  });
  check("a driver is assigned", assigned.body?.data?.status === "ASSIGNED", assigned.body);

  const driverBusy = await api(`/admin/drivers/${driverAId}`, { token: adminToken });
  check("the driver moves to ON_DELIVERY", driverBusy.body.data.status === "ON_DELIVERY", driverBusy.body?.data);

  // maxActiveOrders is 1 for alice.
  const secondOrderId = await placeDeliveryOrder();
  await readyOrder(secondOrderId);
  const secondDelivery = await api("/admin/deliveries", { method: "POST", token: adminToken, body: { orderId: secondOrderId } });
  const overloaded = await api(`/admin/deliveries/${secondDelivery.body.data.id}/assign`, {
    method: "POST",
    token: adminToken,
    body: { driverId: driverAId },
  });
  check("a driver at their limit takes no more work", overloaded.status === 409, overloaded.body?.error);

  const offlineDriver = await api("/admin/drivers", {
    method: "POST",
    token: adminToken,
    body: { userId: adminId, branchId },
  });
  const toOffline = await api(`/admin/deliveries/${secondDelivery.body.data.id}/assign`, {
    method: "POST",
    token: adminToken,
    body: { driverId: offlineDriver.body.data.id },
  });
  check("an off-shift driver is not given work", toOffline.status === 409, toOffline.body?.error);

  // ================= THE DRIVER'S OWN QUEUE =================
  const queue = await api("/me/driver/deliveries", { token: alice.token });
  check("the driver sees their job", queue.body.data.length === 1 && queue.body.data[0].id === deliveryId, queue.body?.data);
  check("with the address to go to", Boolean(queue.body.data[0].order.addressSnapshot), queue.body?.data?.[0]?.order);
  check(
    "and a contact number, even though the account has no phone",
    queue.body.data[0].order.contactPhone === "+923001234567",
    queue.body?.data?.[0]?.order,
  );
  check("but not what the customer paid", queue.body.data[0].order.grandTotal === undefined, queue.body?.data?.[0]?.order);

  const bobQueue = await api("/me/driver/deliveries", { token: bob.token });
  check("another driver sees nothing of it", bobQueue.body.data.length === 0, bobQueue.body?.data);

  const bobSteals = await api(`/me/driver/deliveries/${deliveryId}/status`, {
    method: "PUT",
    token: bob.token,
    body: { status: "ACCEPTED" },
  });
  check("a driver cannot touch another driver's job", bobSteals.status === 404, bobSteals.body?.error);

  const customerPokes = await api(`/me/driver/deliveries/${deliveryId}/status`, {
    method: "PUT",
    token: customerToken,
    body: { status: "DELIVERED" },
  });
  check("a customer cannot drive", customerPokes.status === 403, customerPokes.body?.error);

  // ================= THE RUN =================
  const accepted = await api(`/me/driver/deliveries/${deliveryId}/status`, {
    method: "PUT",
    token: alice.token,
    body: { status: "ACCEPTED" },
  });
  check("the driver accepts the job", accepted.body?.data?.delivery?.status === "ACCEPTED", accepted.body);

  const skipAhead = await api(`/me/driver/deliveries/${deliveryId}/status`, {
    method: "PUT",
    token: alice.token,
    body: { status: "DELIVERED" },
  });
  check("food cannot be delivered before it is collected", skipAhead.status === 409, skipAhead.body?.error);

  const cancelAttempt = await api(`/me/driver/deliveries/${deliveryId}/status`, {
    method: "PUT",
    token: alice.token,
    body: { status: "CANCELLED" },
  });
  check("a driver cannot cancel the order", cancelAttempt.status === 409, cancelAttempt.body?.error);

  await api(`/me/driver/deliveries/${deliveryId}/status`, {
    method: "PUT",
    token: alice.token,
    body: { status: "ARRIVED_AT_STORE" },
  });
  const pickedUp = await api(`/me/driver/deliveries/${deliveryId}/status`, {
    method: "PUT",
    token: alice.token,
    body: { status: "PICKED_UP" },
  });
  check("the driver collects the food", pickedUp.body?.data?.delivery?.status === "PICKED_UP", pickedUp.body);

  const orderNow = await api(`/admin/orders/${orderId}`, { token: adminToken });
  check("the order follows to OUT_FOR_DELIVERY", orderNow.body.data.status === "OUT_FOR_DELIVERY", orderNow.body?.data?.status);

  const handBack = await api(`/admin/deliveries/${deliveryId}/unassign`, { method: "POST", token: adminToken, body: {} });
  check("a job cannot be taken back once the food is in the bag", handBack.status === 409, handBack.body?.error);

  const reassignCarried = await api(`/admin/deliveries/${deliveryId}/assign`, {
    method: "POST",
    token: adminToken,
    body: { driverId: driverBId, reassign: true },
  });
  check("nor reassigned to someone else", reassignCarried.status === 409, reassignCarried.body?.error);

  // ================= TRACKING =================
  const ping = await api("/me/driver/location", {
    method: "POST",
    token: alice.token,
    body: { latitude: 24.8607, longitude: 67.0011, heading: 90 },
  });
  check("the driver app reports a position", ping.status === 200, ping.body?.error);
  check("and it is attached to the active delivery", ping.body.data.deliveryId === deliveryId, ping.body?.data);

  const badPing = await api("/me/driver/location", {
    method: "POST",
    token: alice.token,
    body: { latitude: 200, longitude: 67.0011 },
  });
  check("an impossible coordinate is refused", badPing.status === 400, badPing.body?.error);

  const orderNumber = orderNow.body.data.orderNumber;
  const publicTrack = await api(`/orders/track/${orderNumber}/delivery`);
  check("a customer can follow the driver without signing in", publicTrack.status === 200, publicTrack.body?.error);
  check("the position is shown while the food is in transit", num(publicTrack.body.data.driver.latitude) === 24.8607, publicTrack.body?.data);
  check("only the driver's first name is exposed", publicTrack.body.data.driver.name === "P8", publicTrack.body?.data?.driver);
  check("never their phone number", publicTrack.body.data.driver.phone === undefined, publicTrack.body?.data?.driver);

  const breadcrumbs = await api(`/admin/deliveries/${deliveryId}/track`, { token: adminToken });
  check("a breadcrumb trail is recorded", breadcrumbs.body.data.length >= 1, breadcrumbs.body?.data);

  await api("/me/driver/location", {
    method: "POST",
    token: alice.token,
    body: { latitude: 24.8608, longitude: 67.0012 },
  });
  const sampled = await api(`/admin/deliveries/${deliveryId}/track`, { token: adminToken });
  check("but breadcrumbs are sampled, not one per ping", sampled.body.data.length === 1, sampled.body?.data);

  // ================= HANDOVER =================
  await api("/admin/settings", {
    method: "PUT",
    token: adminToken,
    body: { branchId, values: { "delivery.require_handover_code": true } },
  });

  const issued = await api(`/admin/deliveries/${deliveryId}/handover-code`, { method: "POST", token: adminToken });
  check("a handover code is issued", /^\d{4}$/.test(String(issued.body?.data?.code ?? "")), issued.body?.data);
  const code = issued.body.data.code;

  const stored = await prisma.delivery.findUnique({ where: { id: deliveryId }, select: { otpHash: true } });
  check("only its hash is stored", stored.otpHash && !stored.otpHash.includes(code), { hasHash: Boolean(stored.otpHash) });

  const noCode = await api(`/me/driver/deliveries/${deliveryId}/status`, {
    method: "PUT",
    token: alice.token,
    body: { status: "DELIVERED" },
  });
  check("delivery without the code is refused", noCode.status === 400, noCode.body?.error);

  const wrongCode = await api(`/me/driver/deliveries/${deliveryId}/status`, {
    method: "PUT",
    token: alice.token,
    body: { status: "DELIVERED", handoverCode: code === "0000" ? "1111" : "0000" },
  });
  check("a wrong code is refused", wrongCode.status === 400, wrongCode.body?.error);

  const overCollect = await api(`/me/driver/deliveries/${deliveryId}/status`, {
    method: "PUT",
    token: alice.token,
    body: { status: "DELIVERED", handoverCode: code, collectedCod: 99999 },
  });
  check("a driver cannot record collecting more than the bill", overCollect.status === 400, overCollect.body?.error);

  const delivered = await api(`/me/driver/deliveries/${deliveryId}/status`, {
    method: "PUT",
    token: alice.token,
    body: { status: "DELIVERED", handoverCode: code, recipientName: "P8 Customer" },
  });
  check("the right code completes the delivery", delivered.body?.data?.delivery?.status === "DELIVERED", delivered.body);

  const usedCode = await prisma.delivery.findUnique({ where: { id: deliveryId }, select: { otpHash: true } });
  check("the code is single-use", usedCode.otpHash === null, usedCode);

  // ================= COD BECOMES A DEBT =================
  const paidOrder = await api(`/admin/orders/${orderId}/payments`, { token: adminToken });
  check("collecting COD settles the order", paidOrder.body.data.paymentState === "PAID", paidOrder.body?.data);
  check("through a cash-on-delivery payment", paidOrder.body.data.payments.some((p) => p.method === "CASH_ON_DELIVERY" && p.status === "CAPTURED"), paidOrder.body?.data?.payments);

  const driverWithCash = await api(`/admin/drivers/${driverAId}`, { token: adminToken });
  check("the cash becomes the driver's debt", num(driverWithCash.body.data.cashInHand) === 1000, driverWithCash.body?.data);
  check("and they are free for the next job", driverWithCash.body.data.status === "AVAILABLE", driverWithCash.body?.data);

  const orderDelivered = await api(`/admin/orders/${orderId}`, { token: adminToken });
  check("the order is marked delivered", orderDelivered.body.data.status === "DELIVERED", orderDelivered.body?.data?.status);

  const endWithCash = await api("/me/driver/shift", {
    method: "DELETE",
    token: alice.token,
    body: { cashHandedOver: 99999 },
  });
  check("a driver cannot hand over more than they hold", endWithCash.status === 400, endWithCash.body?.error);

  // ================= FAILED DELIVERY =================
  const failOrderId = await placeDeliveryOrder();
  await readyOrder(failOrderId);
  const failDelivery = await api("/admin/deliveries", { method: "POST", token: adminToken, body: { orderId: failOrderId } });
  const failId = failDelivery.body.data.id;

  await api(`/admin/deliveries/${failId}/assign`, { method: "POST", token: adminToken, body: { driverId: driverBId } });
  await api(`/me/driver/deliveries/${failId}/status`, { method: "PUT", token: bob.token, body: { status: "ACCEPTED" } });
  await api(`/me/driver/deliveries/${failId}/status`, { method: "PUT", token: bob.token, body: { status: "PICKED_UP" } });

  const failNoReason = await api(`/me/driver/deliveries/${failId}/status`, {
    method: "PUT",
    token: bob.token,
    body: { status: "FAILED" },
  });
  check("a failed delivery needs a reason", failNoReason.status === 400, failNoReason.body?.error);

  const failed = await api(`/me/driver/deliveries/${failId}/status`, {
    method: "PUT",
    token: bob.token,
    body: { status: "FAILED", reason: "Nobody at the address" },
  });
  check("a delivery can be failed with a reason", failed.body?.data?.delivery?.status === "FAILED", failed.body);

  const bobFree = await api(`/admin/drivers/${driverBId}`, { token: adminToken });
  check("a failed drop frees the driver", bobFree.body.data.status === "AVAILABLE", bobFree.body?.data);
  check("and collects no cash", num(bobFree.body.data.cashInHand) === 0, bobFree.body?.data);

  const retried = await api(`/admin/deliveries/${failId}/assign`, {
    method: "POST",
    token: adminToken,
    body: { driverId: driverBId, reassign: true },
  });
  check("a failed delivery can be sent out again", retried.body?.data?.status === "ASSIGNED", retried.body);

  // ================= PAYOUTS =================
  const backdated = new Date(Date.now() - 86_400_000);
  const tomorrow = new Date(Date.now() + 86_400_000);

  const badPeriod = await api("/admin/driver-payouts", {
    method: "POST",
    token: adminToken,
    body: { driverId: driverAId, periodStart: tomorrow.toISOString(), periodEnd: backdated.toISOString() },
  });
  check("a payout period must run forwards", badPeriod.status === 400, badPeriod.body?.error);

  const payout = await api("/admin/driver-payouts", {
    method: "POST",
    token: adminToken,
    body: { driverId: driverAId, periodStart: backdated.toISOString(), periodEnd: tomorrow.toISOString() },
  });
  check("a payout is generated", payout.status === 201, payout.body);
  check("it counts the delivered job", payout.body.data.deliveriesCount === 1, payout.body?.data);
  check("earnings come from the delivery", num(payout.body.data.earningsAmount) === 150, payout.body?.data);
  check("the COD the driver holds is deducted", num(payout.body.data.codDeduction) === 1000, payout.body?.data);
  check("so the net is earnings minus the cash they owe", num(payout.body.data.netAmount) === 150 - 1000, payout.body?.data);
  const payoutId = payout.body.data.id;

  const duplicatePayout = await api("/admin/driver-payouts", {
    method: "POST",
    token: adminToken,
    body: { driverId: driverAId, periodStart: backdated.toISOString(), periodEnd: tomorrow.toISOString() },
  });
  check("the same period cannot be paid twice", duplicatePayout.status === 409, duplicatePayout.body?.error);

  const payBeforeApprove = await api(`/admin/driver-payouts/${payoutId}/paid`, { method: "POST", token: adminToken, body: {} });
  check("a payout must be approved before it is paid", payBeforeApprove.status === 409, payBeforeApprove.body?.error);

  const approvedPayout = await api(`/admin/driver-payouts/${payoutId}/approve`, { method: "POST", token: adminToken });
  check("a payout is approved", approvedPayout.body?.data?.status === "APPROVED", approvedPayout.body);

  const paidPayout = await api(`/admin/driver-payouts/${payoutId}/paid`, {
    method: "POST",
    token: adminToken,
    body: { paymentReference: `BANK-${stamp}` },
  });
  check("and marked paid", paidPayout.body?.data?.status === "PAID", paidPayout.body);

  const driverSettled = await api(`/admin/drivers/${driverAId}`, { token: adminToken });
  check("paying it clears the COD debt", num(driverSettled.body.data.cashInHand) === 0, driverSettled.body?.data);

  const secondPayout = await api("/admin/driver-payouts", {
    method: "POST",
    token: adminToken,
    body: {
      driverId: driverAId,
      periodStart: new Date(Date.now() - 172_800_000).toISOString(),
      periodEnd: new Date(Date.now() + 172_800_000).toISOString(),
    },
  });
  check("a second payout does not pay the same drop again", secondPayout.body?.data?.deliveriesCount === 0, secondPayout.body?.data);

  const payoutAudit = await prisma.auditLog.findFirst({
    where: { action: "driver_payout.paid", entityId: payoutId },
  });
  check("paying a driver is audited", Boolean(payoutAudit), payoutAudit);

  // ================= PERMISSIONS =================
  const custDrivers = await api("/admin/drivers", { token: customerToken });
  check("a customer cannot read the driver list", custDrivers.status === 403, custDrivers.body?.error);

  const custDispatch = await api(`/admin/dispatch?branchId=${branchId}`, { token: customerToken });
  check("nor the dispatch board", custDispatch.status === 403, custDispatch.body?.error);

  const driverReadsAll = await api("/admin/deliveries", { token: alice.token });
  check("a driver cannot read every delivery", driverReadsAll.status === 403, driverReadsAll.body?.error);

  const driverPays = await api(`/admin/driver-payouts/${payoutId}/approve`, { method: "POST", token: alice.token });
  check("nor approve their own payout", driverPays.status === 403, driverPays.body?.error);

  // ================= SHIFT END =================
  const endShift = await api("/me/driver/shift", {
    method: "DELETE",
    token: alice.token,
    body: { cashHandedOver: 0 },
  });
  check("the shift ends", endShift.status === 200, endShift.body?.error);

  const offline = await api(`/admin/drivers/${driverAId}`, { token: adminToken });
  check("and the driver goes offline", offline.body.data.status === "OFFLINE", offline.body?.data);

  const bobBusy = await api("/me/driver/shift", {
    method: "DELETE",
    token: bob.token,
    body: { cashHandedOver: 0 },
  });
  check("a driver holding active work cannot end their shift", bobBusy.status === 409, bobBusy.body?.error);
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { contains: tag } }, select: { id: true } });
  const ids = [...new Set([...created.userIds, ...users.map((u) => u.id)])];
  const branchIds = [...created.branchIds];

  const orders = await prisma.order.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);
  const drivers = await prisma.driver.findMany({ where: { userId: { in: ids } }, select: { id: true } });
  const driverIds = drivers.map((d) => d.id);

  await prisma.driverPayoutLine.deleteMany({ where: { payout: { driverId: { in: driverIds } } } });
  await prisma.driverPayout.deleteMany({ where: { driverId: { in: driverIds } } });
  await prisma.deliveryTrackPoint.deleteMany({ where: { delivery: { orderId: { in: orderIds } } } });
  await prisma.delivery.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.driverShift.deleteMany({ where: { driverId: { in: driverIds } } });
  await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });

  await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.cashMovement.deleteMany({ where: { session: { branchId: { in: branchIds } } } });
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.cashRegisterSession.deleteMany({ where: { branchId: { in: branchIds } } });

  await prisma.couponRedemption.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderDiscount.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.invoice.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.review.deleteMany({ where: { OR: [{ userId: { in: ids } }, { orderId: { in: orderIds } }] } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.numberSequence.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.cart.deleteMany({ where: { userId: { in: ids } } });
  for (const id of orderIds) {
    await prisma.outboxEvent.deleteMany({ where: { payload: { path: ["orderId"], equals: id } } });
  }

  await prisma.menu.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.product.deleteMany({ where: { slug: { contains: String(stamp) } } });
  await prisma.category.deleteMany({ where: { slug: { contains: String(stamp) } } });

  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.credentialToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userRoleAssignment.deleteMany({ where: { userId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.address.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: "E2E8" } } });
  await prisma.setting.deleteMany({});

  const leftovers = {
    users: await prisma.user.count(),
    branches: await prisma.branch.count(),
    orders: await prisma.order.count(),
    drivers: await prisma.driver.count(),
    deliveries: await prisma.delivery.count(),
    trackPoints: await prisma.deliveryTrackPoint.count(),
    shifts: await prisma.driverShift.count(),
    payouts: await prisma.driverPayout.count(),
    payments: await prisma.payment.count(),
    products: await prisma.product.count(),
    settings: await prisma.setting.count(),
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
  console.log("SUITE ERROR:", error.message, "\n", error.stack?.split("\n").slice(0, 5).join("\n"));
  failures.push("suite crashed: " + error.message);
} finally {
  const leftovers = await cleanup();
  await prisma.$disconnect();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));

  const dirty = Object.entries(leftovers).filter(([key, value]) => key !== "roles" && value > 0);
  if (dirty.length) console.log("WARNING: database not clean:", JSON.stringify(dirty));

  process.exit(failures.length || dirty.length ? 1 : 0);
}
