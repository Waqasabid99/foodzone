import "dotenv/config";
import crypto from "node:crypto";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions, warmUpDatabase } from "../src/lib/db-pool.js";

/**
 * Phase 7 — Payments, end to end.
 *
 * Start a server first:
 *   APP_URL=http://localhost:3100 CRON_SECRET=phase2-test-secret npx next dev -p 3100
 *
 * The arithmetic of payment state lives in tests/unit.mjs. What this suite
 * proves is what only exists once money, HTTP and a database are involved:
 * that a double-tapped charge is one charge, that a forged webhook is refused
 * and a genuine one is applied exactly once, that a refund needs two
 * permissions, that a customer cannot mark their own order paid, and that a
 * till session reconciles against what the system independently expected.
 */
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });
const MOCK_SECRET = process.env.MOCK_PAYMENT_SECRET ?? "mock-payment-secret";

const stamp = Date.now();
const tag = `e2e7-${stamp}`;
const emailOf = (name) => `${tag}-${name}@example.test`;
const BRANCH_CODE = `E2E7${String(stamp).slice(-5)}`;
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
const nextIp = () => `10.70.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;

async function api(pathname, { method = "GET", body, token, ip, session, headers = {}, raw } = {}) {
  const res = await fetch(`${BASE}/api/v1${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip ?? nextIp(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(session ? { "x-session-id": session } : {}),
      ...headers,
    },
    ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
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

/** Signs a mock-gateway callback exactly as the provider verifies it. */
function signedWebhook(payload) {
  const raw = JSON.stringify(payload);
  return { raw, signature: crypto.createHmac("sha256", MOCK_SECRET).update(raw).digest("hex") };
}

async function waitFor(predicate, { timeoutMs = 8000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function main() {
  // ================= SETUP =================
  const adminReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P7 Admin", email: emailOf("admin"), password: "admin-passphrase-7" },
  });
  const adminId = adminReg.body.data.user.id;
  created.userIds.add(adminId);
  await prisma.user.update({
    where: { id: adminId },
    data: { isSuperAdmin: true, status: "ACTIVE", emailVerifiedAt: new Date() },
  });
  const adminToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("admin"), password: "admin-passphrase-7" } })
  ).body.data.accessToken;

  const branch = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: BRANCH_CODE, name: "P7 Branch", city: "Karachi", timezone: "Asia/Karachi" },
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
      },
    },
  });
  await api("/admin/settings", {
    method: "PUT",
    token: adminToken,
    body: { values: { "ordering.prices_include_tax": true } },
  });

  const category = await api("/admin/categories", { method: "POST", token: adminToken, body: { name: `Food ${stamp}` } });
  const categoryId = category.body.data.id;

  const burger = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: { name: `Burger ${stamp}`, categoryId, price: 1000 },
  });
  const burgerId = burger.body.data.id;
  await api(`/admin/products/${burgerId}/publish`, { method: "PUT", token: adminToken, body: { isActive: true } });

  const menu = await api("/admin/menus", {
    method: "POST",
    token: adminToken,
    body: { branchId, isActive: true, name: `Main ${stamp}`, type: "DINE_IN", isDefault: true },
  });
  await api(`/admin/menus/${menu.body.data.id}/items`, {
    method: "POST",
    token: adminToken,
    body: { productId: burgerId },
  });

  check("catalog is set up", burger.status === 201 && menu.status === 201);

  /** Places a staff order worth `quantity` x 1000 and returns its id. */
  async function placeOrder(quantity = 1) {
    const res = await api("/admin/orders", {
      method: "POST",
      token: adminToken,
      body: {
        branchId,
        type: "DINE_IN",
        channel: "POS",
        items: [{ productId: burgerId, quantity }],
        guest: { name: "Walk-in" },
      },
    });
    if (res.status !== 201) throw new Error(`order failed: ${JSON.stringify(res.body).slice(0, 200)}`);
    return res.body.data.id;
  }

  // ================= CASH AT THE COUNTER =================
  const registerOpen = await api("/admin/registers", {
    method: "POST",
    token: adminToken,
    body: { branchId, registerName: "till-1", openingFloat: 5000 },
  });
  check("a register session opens", registerOpen.status === 201, registerOpen.body);
  const sessionId = registerOpen.body.data.id;

  const doubleOpen = await api("/admin/registers", {
    method: "POST",
    token: adminToken,
    body: { branchId, registerName: "till-1", openingFloat: 1000 },
  });
  check("one drawer cannot have two open sessions", doubleOpen.status === 409, doubleOpen.body?.error);

  const cashOrderId = await placeOrder(1);

  const cashPayment = await api("/admin/payments", {
    method: "POST",
    token: adminToken,
    body: { orderId: cashOrderId, method: "CASH" },
  });
  check("a cash payment is created for the full balance", cashPayment.status === 201, cashPayment.body);
  check("it defaults to what the order owes", num(cashPayment.body.data.payment.amount) === 1000, cashPayment.body?.data);
  check("it starts pending, not paid", cashPayment.body.data.payment.status === "PENDING", cashPayment.body?.data);
  const cashPaymentId = cashPayment.body.data.payment.id;

  const stillUnpaid = await api(`/admin/orders/${cashOrderId}`, { token: adminToken });
  check("creating a payment does not mark the order paid", stillUnpaid.body.data.paymentState === "UNPAID", stillUnpaid.body?.data?.paymentState);

  const collected = await api(`/admin/payments/${cashPaymentId}/collect`, {
    method: "POST",
    token: adminToken,
    body: { registerSessionId: sessionId },
  });
  check("collecting the cash captures it", collected.body?.data?.payment?.status === "CAPTURED", collected.body);

  const paidOrder = await api(`/admin/orders/${cashOrderId}`, { token: adminToken });
  check("the order becomes PAID", paidOrder.body.data.paymentState === "PAID", paidOrder.body?.data?.paymentState);

  const collectAgain = await api(`/admin/payments/${cashPaymentId}/collect`, {
    method: "POST",
    token: adminToken,
    body: { registerSessionId: sessionId },
  });
  check("collecting twice is idempotent, not a double count", collectAgain.body?.data?.changed === false, collectAgain.body?.data);

  const sessionAfterSale = await api(`/admin/registers/${sessionId}`, { token: adminToken });
  check("the sale lands in the drawer", num(sessionAfterSale.body.data.expectedCash) === 6000, sessionAfterSale.body?.data);

  // ================= CASH CANNOT GO ROUND THE DRAWER =================
  // `collect` is the endpoint that attaches cash to a session. `capture` is the
  // one for gateway money, and it used to accept cash too — same permission set
  // on the Cashier role, one route along. The order read PAID, the notes were in
  // the till, and no movement was written, so the drawer closed short by the
  // sale and the cashier wore it.
  const bypassOrderId = await placeOrder(1);
  const bypassPayment = await api("/admin/payments", {
    method: "POST",
    token: adminToken,
    body: { orderId: bypassOrderId, method: "CASH" },
  });
  const bypassId = bypassPayment.body.data.payment.id;

  const bypass = await api(`/admin/payments/${bypassId}/capture`, {
    method: "POST",
    token: adminToken,
    body: {},
  });
  check("cash cannot be captured around the till", bypass.status === 409, { status: bypass.status, body: bypass.body?.error });

  const stillPending = await api(`/admin/payments/${bypassId}`, { token: adminToken });
  check("and the refused capture took no money", stillPending.body?.data?.status === "PENDING", stillPending.body?.data?.status);

  const drawerUnmoved = await api(`/admin/registers/${sessionId}`, { token: adminToken });
  check("so the drawer is untouched by it", num(drawerUnmoved.body.data.expectedCash) === 6000, drawerUnmoved.body?.data);

  const properly = await api(`/admin/payments/${bypassId}/collect`, {
    method: "POST",
    token: adminToken,
    body: { registerSessionId: sessionId },
  });
  check("the same cash goes through collect instead", properly.body?.data?.payment?.status === "CAPTURED", properly.body);

  const drawerMoved = await api(`/admin/registers/${sessionId}`, { token: adminToken });
  check("and the drawer counts it", num(drawerMoved.body.data.expectedCash) === 7000, drawerMoved.body?.data);

  // Money that was captured outside a drawer before the refusal existed is
  // still sitting in real tills. `collect` has to be able to adopt it, or the
  // only repair is a hand-written adjustment that hides what happened. Forged
  // here directly, because the endpoint that used to produce this state now
  // refuses to.
  const orphanOrderId = await placeOrder(1);
  const orphanPayment = await api("/admin/payments", {
    method: "POST",
    token: adminToken,
    body: { orderId: orphanOrderId, method: "CASH" },
  });
  const orphanId = orphanPayment.body.data.payment.id;
  await prisma.payment.update({
    where: { id: orphanId },
    data: { status: "CAPTURED", capturedAt: new Date(), registerSessionId: null },
  });

  const adopted = await api(`/admin/payments/${orphanId}/collect`, {
    method: "POST",
    token: adminToken,
    body: { registerSessionId: sessionId },
  });
  check("cash captured with no drawer can still be put in one", adopted.status === 200, adopted.body?.error);

  const drawerAdopted = await api(`/admin/registers/${sessionId}`, { token: adminToken });
  check("and it reaches the count", num(drawerAdopted.body.data.expectedCash) === 8000, drawerAdopted.body?.data);

  const adoptAgain = await api(`/admin/payments/${orphanId}/collect`, {
    method: "POST",
    token: adminToken,
    body: { registerSessionId: sessionId },
  });
  await adoptAgain;
  const drawerTwice = await api(`/admin/registers/${sessionId}`, { token: adminToken });
  check("adopting twice does not count it twice", num(drawerTwice.body.data.expectedCash) === 8000, drawerTwice.body?.data);

  // ================= SPLIT PAYMENT =================
  const splitOrderId = await placeOrder(2); // 2000

  const half = await api("/admin/payments", {
    method: "POST",
    token: adminToken,
    body: { orderId: splitOrderId, method: "CASH", amount: 800 },
  });
  await api(`/admin/payments/${half.body.data.payment.id}/collect`, {
    method: "POST",
    token: adminToken,
    body: { registerSessionId: sessionId },
  });

  const partial = await api(`/admin/orders/${splitOrderId}/payments`, { token: adminToken });
  check("a part payment leaves the order partially paid", partial.body.data.paymentState === "PARTIALLY_PAID", partial.body?.data);
  check("and reports what is still due", num(partial.body.data.amountDue) === 1200, partial.body?.data);

  const overpay = await api("/admin/payments", {
    method: "POST",
    token: adminToken,
    body: { orderId: splitOrderId, method: "CASH", amount: 5000 },
  });
  check("a payment larger than the balance is refused", overpay.status === 400, overpay.body?.error);

  const rest = await api("/admin/payments", {
    method: "POST",
    token: adminToken,
    body: { orderId: splitOrderId, method: "CASH" },
  });
  check("the remainder defaults to exactly what is left", num(rest.body.data.payment.amount) === 1200, rest.body?.data);
  await api(`/admin/payments/${rest.body.data.payment.id}/collect`, {
    method: "POST",
    token: adminToken,
    body: { registerSessionId: sessionId },
  });

  const settled = await api(`/admin/orders/${splitOrderId}/payments`, { token: adminToken });
  check("the split bill settles to PAID", settled.body.data.paymentState === "PAID", settled.body?.data);

  const afterSettled = await api("/admin/payments", {
    method: "POST",
    token: adminToken,
    body: { orderId: splitOrderId, method: "CASH" },
  });
  check("a fully paid order cannot be charged again", afterSettled.status === 409, afterSettled.body?.error);

  // ================= IDEMPOTENCY =================
  const idemOrderId = await placeOrder(1);
  const key = `idem-${stamp}-a`;

  const firstTap = await api("/admin/payments", {
    method: "POST",
    token: adminToken,
    body: { orderId: idemOrderId, method: "CASH", idempotencyKey: key },
  });
  const secondTap = await api("/admin/payments", {
    method: "POST",
    token: adminToken,
    body: { orderId: idemOrderId, method: "CASH", idempotencyKey: key },
  });

  check("a repeated charge with the same key is one charge", firstTap.body.data.payment.id === secondTap.body.data.payment.id, {
    first: firstTap.body?.data?.payment?.id,
    second: secondTap.body?.data?.payment?.id,
  });
  check("the replay says so", secondTap.body.data.replayed === true, secondTap.body?.data);

  const rowCount = await prisma.payment.count({ where: { orderId: idemOrderId } });
  check("only one payment row exists", rowCount === 1, { rowCount });

  const reusedKey = await api("/admin/payments", {
    method: "POST",
    token: adminToken,
    body: { orderId: cashOrderId, method: "CASH", idempotencyKey: key },
  });
  check("the same key on a different order is refused, not silently reused", reusedKey.status === 409, reusedKey.body?.error);

  // ================= ONLINE PAYMENT VIA WEBHOOK =================
  const onlineOrderId = await placeOrder(1);

  const intent = await api("/admin/payments", {
    method: "POST",
    token: adminToken,
    body: { orderId: onlineOrderId, method: "CARD", provider: "mock" },
  });
  check("an online charge returns a client action", Boolean(intent.body?.data?.clientAction?.url), intent.body?.data);
  const onlinePaymentId = intent.body.data.payment.id;
  const providerOrderId = intent.body.data.payment.providerOrderId;

  const unsigned = await api("/webhooks/payments/mock", {
    method: "POST",
    raw: JSON.stringify({ id: `evt-${stamp}-x`, type: "payment.succeeded", data: { providerOrderId } }),
  });
  check("an unsigned webhook is rejected", unsigned.status === 401, unsigned.body?.error);

  const tampered = signedWebhook({ id: `evt-${stamp}-t`, type: "payment.succeeded", data: { providerOrderId } });
  const forged = await api("/webhooks/payments/mock", {
    method: "POST",
    raw: tampered.raw.replace("payment.succeeded", "payment.captured"),
    headers: { "x-mock-signature": tampered.signature },
  });
  check("a webhook whose body was altered after signing is rejected", forged.status === 401, forged.body?.error);

  const notStored = await prisma.paymentWebhookEvent.count({ where: { eventId: { contains: String(stamp) } } });
  check("nothing unverified is stored", notStored === 0, { notStored });

  const eventId = `evt-${stamp}-ok`;
  const genuine = signedWebhook({
    id: eventId,
    type: "payment.succeeded",
    data: { providerOrderId, providerPaymentId: `mock_pay_${stamp}`, amount: 1000 },
  });

  const applied = await api("/webhooks/payments/mock", {
    method: "POST",
    raw: genuine.raw,
    headers: { "x-mock-signature": genuine.signature },
  });
  check("a genuine webhook is accepted", applied.status === 200, applied.body);
  check("and is applied", applied.body?.data?.status === "PROCESSED", applied.body?.data);

  const onlinePaid = await api(`/admin/orders/${onlineOrderId}/payments`, { token: adminToken });
  check("the order is paid by the callback", onlinePaid.body.data.paymentState === "PAID", onlinePaid.body?.data);

  const redelivered = await api("/webhooks/payments/mock", {
    method: "POST",
    raw: genuine.raw,
    headers: { "x-mock-signature": genuine.signature },
  });
  check("a redelivered webhook returns 200, not an error", redelivered.status === 200, redelivered.body);
  check("and is recognised as a duplicate", redelivered.body?.data?.duplicate === true, redelivered.body?.data);

  const eventRows = await prisma.paymentWebhookEvent.count({ where: { eventId } });
  check("redelivery does not store a second event", eventRows === 1, { eventRows });

  const paymentsOnOrder = await prisma.payment.count({ where: { orderId: onlineOrderId, status: "CAPTURED" } });
  check("nor capture the money twice", paymentsOnOrder === 1, { paymentsOnOrder });

  const unknownType = signedWebhook({ id: `evt-${stamp}-u`, type: "invoice.something_new", data: {} });
  const ignored = await api("/webhooks/payments/mock", {
    method: "POST",
    raw: unknownType.raw,
    headers: { "x-mock-signature": unknownType.signature },
  });
  check("an unrecognised event type is stored and ignored, not failed", ignored.status === 200 && ignored.body.data.status === "IGNORED", ignored.body?.data);

  const webhookList = await api("/admin/payment-webhooks", { token: adminToken });
  check("webhook events are visible to staff", webhookList.body?.data?.items?.length >= 2, webhookList.body?.data);

  // ================= REFUNDS =================
  const noReason = await api("/admin/refunds", {
    method: "POST",
    token: adminToken,
    body: { paymentId: onlinePaymentId },
  });
  check("a refund without a reason is refused", noReason.status === 400, noReason.body?.error);

  const tooMuch = await api("/admin/refunds", {
    method: "POST",
    token: adminToken,
    body: { paymentId: onlinePaymentId, amount: 5000, reason: "Trying it on" },
  });
  check("a refund larger than the payment is refused", tooMuch.status === 400, tooMuch.body?.error);

  const partialRefund = await api("/admin/refunds", {
    method: "POST",
    token: adminToken,
    body: { paymentId: onlinePaymentId, amount: 300, reason: "Missing side" },
  });
  check("a partial refund can be requested", partialRefund.status === 201, partialRefund.body);
  const refundId = partialRefund.body.data.id;
  check("it starts as a request, not a payment", partialRefund.body.data.status === "REQUESTED", partialRefund.body?.data);

  const stillPaid = await api(`/admin/orders/${onlineOrderId}/payments`, { token: adminToken });
  check("a requested refund has moved no money yet", stillPaid.body.data.paymentState === "PAID", stillPaid.body?.data);

  const overlapping = await api("/admin/refunds", {
    method: "POST",
    token: adminToken,
    body: { paymentId: onlinePaymentId, amount: 900, reason: "Second bite" },
  });
  check("a second refund cannot exceed what is left in flight", overlapping.status === 400, overlapping.body?.error);

  const approved = await api(`/admin/refunds/${refundId}/approve`, { method: "POST", token: adminToken });
  check("approving processes the refund", approved.body?.data?.status === "COMPLETED", approved.body);

  const afterRefund = await api(`/admin/orders/${onlineOrderId}/payments`, { token: adminToken });
  check("the order becomes partially refunded", afterRefund.body.data.paymentState === "PARTIALLY_REFUNDED", afterRefund.body?.data);
  check("and reports the refund against the balance", num(afterRefund.body.data.amountDue) === 300, afterRefund.body?.data);

  const remainder = await api("/admin/refunds", {
    method: "POST",
    token: adminToken,
    body: { paymentId: onlinePaymentId, reason: "Rest of it" },
  });
  check("the rest can then be refunded", num(remainder.body.data.amount) === 700, remainder.body?.data);
  await api(`/admin/refunds/${remainder.body.data.id}/approve`, { method: "POST", token: adminToken });

  const fullyRefunded = await api(`/admin/orders/${onlineOrderId}/payments`, { token: adminToken });
  check("the order ends up REFUNDED", fullyRefunded.body.data.paymentState === "REFUNDED", fullyRefunded.body?.data);

  const exhausted = await api("/admin/refunds", {
    method: "POST",
    token: adminToken,
    body: { paymentId: onlinePaymentId, reason: "Once more" },
  });
  check("a fully refunded payment cannot be refunded again", exhausted.status === 409, exhausted.body?.error);

  const refundAudit = await prisma.auditLog.findFirst({
    where: { action: "refund.approve", entityId: refundId },
  });
  check("approving a refund is audited", Boolean(refundAudit), refundAudit);
  check("the audit names who approved it", refundAudit?.actorId === adminId, refundAudit);

  // ================= VOID vs REFUND =================
  const voidOrderId = await placeOrder(1);
  const pending = await api("/admin/payments", {
    method: "POST",
    token: adminToken,
    body: { orderId: voidOrderId, method: "CARD", provider: "mock" },
  });
  const voided = await api(`/admin/payments/${pending.body.data.payment.id}/void`, {
    method: "POST",
    token: adminToken,
    body: { reason: "Customer changed their mind" },
  });
  check("a pending payment can be voided", voided.body?.data?.payment?.status === "CANCELLED", voided.body);

  const voidCaptured = await api(`/admin/payments/${cashPaymentId}/void`, { method: "POST", token: adminToken, body: {} });
  check("captured money must be refunded, not voided", voidCaptured.status === 409, voidCaptured.body?.error);

  // ================= PERMISSIONS =================
  const custReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P7 Customer", email: emailOf("cust"), password: "customer-passphrase-7" },
  });
  const customerId = custReg.body.data.user.id;
  created.userIds.add(customerId);
  await prisma.user.update({ where: { id: customerId }, data: { emailVerifiedAt: new Date() } });
  const customerToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("cust"), password: "customer-passphrase-7" } })
  ).body.data.accessToken;

  const custPayments = await api("/admin/payments", { token: customerToken });
  check("a customer cannot read the payment ledger", custPayments.status === 403, custPayments.body?.error);

  const custRefund = await api("/admin/refunds", {
    method: "POST",
    token: customerToken,
    body: { paymentId: cashPaymentId, amount: 100, reason: "Give me money" },
  });
  check("a customer cannot request a refund on someone else's payment", custRefund.status === 403, custRefund.body?.error);

  const custRegister = await api("/admin/registers", {
    method: "POST",
    token: customerToken,
    body: { branchId, registerName: "mine" },
  });
  check("a customer cannot open a till", custRegister.status === 403, custRegister.body?.error);

  // A staff member who may take money but not give it back.
  const staffReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P7 Cashier", email: emailOf("cashier"), password: "cashier-passphrase-7" },
  });
  const staffId = staffReg.body.data.user.id;
  created.userIds.add(staffId);
  await prisma.user.update({ where: { id: staffId }, data: { emailVerifiedAt: new Date(), status: "ACTIVE" } });

  const role = await api("/admin/roles", {
    method: "POST",
    token: adminToken,
    body: { name: `P7 Cashier ${stamp}`, description: "Takes money, cannot refund" },
  });
  await api(`/admin/roles/${role.body.data.id}/permissions`, {
    method: "PUT",
    token: adminToken,
    body: { permissionKeys: ["payments.read", "payments.capture", "payments.mark_collected", "refunds.request", "orders.read"] },
  });
  await api(`/admin/users/${staffId}/roles`, {
    method: "POST",
    token: adminToken,
    body: { roleId: role.body.data.id, branchId },
  });
  const staffToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("cashier"), password: "cashier-passphrase-7" } })
  ).body.data.accessToken;

  const cashierOrderId = await placeOrder(1);
  const cashierPayment = await api("/admin/payments", {
    method: "POST",
    token: staffToken,
    body: { orderId: cashierOrderId, method: "CASH" },
  });
  check("a cashier can take money", cashierPayment.status === 201, cashierPayment.body?.error);
  await api(`/admin/payments/${cashierPayment.body.data.payment.id}/collect`, {
    method: "POST",
    token: staffToken,
    body: { registerSessionId: sessionId },
  });

  const cashierRequest = await api("/admin/refunds", {
    method: "POST",
    token: staffToken,
    body: { paymentId: cashierPayment.body.data.payment.id, amount: 100, reason: "Customer complaint" },
  });
  check("a cashier can raise a refund request", cashierRequest.status === 201, cashierRequest.body?.error);

  const cashierApprove = await api(`/admin/refunds/${cashierRequest.body.data.id}/approve`, {
    method: "POST",
    token: staffToken,
  });
  check("but cannot approve their own request", cashierApprove.status === 403, cashierApprove.body?.error);

  const cashierClose = await api(`/admin/registers/${sessionId}/close`, {
    method: "POST",
    token: staffToken,
    body: { countedCash: 1 },
  });
  check("and cannot close the till", cashierClose.status === 403, cashierClose.body?.error);

  // A second drawer, opened after the one the sale was rung on. A cash refund
  // used to come out of whichever session was opened last at the branch, so the
  // till that took the money closed over and an unrelated till closed short —
  // two false variances from one correct refund. The money leaves the drawer
  // the sale is in.
  const eveningTill = await api("/admin/registers", {
    method: "POST",
    token: adminToken,
    body: { branchId, registerName: "till-2", openingFloat: 2000 },
  });
  check("a second till opens on its own register", eveningTill.status === 201, eveningTill.body?.error);
  const eveningId = eveningTill.body.data.id;

  const managerApprove = await api(`/admin/refunds/${cashierRequest.body.data.id}/approve`, {
    method: "POST",
    token: adminToken,
  });
  check("a manager can approve it", managerApprove.body?.data?.status === "COMPLETED", managerApprove.body);

  const sellingTill = await api(`/admin/registers/${sessionId}`, { token: adminToken });
  const refundHere = (sellingTill.body.data.movements ?? []).filter((m) => m.type === "REFUND");
  check("the refund leaves the till that took the money", refundHere.length === 1, {
    movements: (sellingTill.body.data.movements ?? []).map((m) => m.type),
  });
  check("for the amount refunded", refundHere[0] && num(refundHere[0].amount) === -100, refundHere[0]);

  const otherTill = await api(`/admin/registers/${eveningId}`, { token: adminToken });
  check("and not out of an unrelated drawer", (otherTill.body.data.movements ?? []).length === 0, otherTill.body?.data?.movements);
  check("which still holds just its float", num(otherTill.body.data.expectedCash) === 2000, otherTill.body?.data);

  await api(`/admin/registers/${eveningId}/close`, {
    method: "POST",
    token: adminToken,
    body: { countedCash: 2000, notes: "Evening till, never used" },
  });

  // ================= CUSTOMER SELF-SERVICE =================
  const custOrder = await api("/admin/orders", {
    method: "POST",
    token: adminToken,
    body: {
      branchId,
      type: "DINE_IN",
      channel: "POS",
      items: [{ productId: burgerId, quantity: 1 }],
      userId: customerId,
    },
  });
  const custOrderId = custOrder.body.data.id;

  const cashSelfPay = await api(`/me/orders/${custOrderId}/pay`, {
    method: "POST",
    token: customerToken,
    body: { method: "CASH" },
  });
  check("a customer cannot mark their own order paid in cash", cashSelfPay.status === 400, cashSelfPay.body?.error);

  const selfPay = await api(`/me/orders/${custOrderId}/pay`, {
    method: "POST",
    token: customerToken,
    body: { method: "CARD", idempotencyKey: `self-${stamp}` },
  });
  check("a customer can start an online payment", selfPay.status === 201, selfPay.body?.error);
  check("the amount comes from the order, not the request", num(selfPay.body.data.amount) === 1000, selfPay.body?.data);

  const otherOrder = await api(`/me/orders/${cashOrderId}/pay`, { token: customerToken });
  check("a customer cannot see payments on an order that is not theirs", otherOrder.status === 404, otherOrder.body?.error);

  const ownView = await api(`/me/orders/${custOrderId}/pay`, { token: customerToken });
  check("a customer sees what they owe", num(ownView.body.data.amountDue) === 1000, ownView.body?.data);
  check("but never the gateway internals", ownView.body.data.payments.every((p) => p.providerPaymentId === undefined), ownView.body?.data?.payments);

  // ================= CLOSING THE TILL =================
  const movement = await api(`/admin/registers/${sessionId}/movements`, {
    method: "POST",
    token: adminToken,
    body: { type: "PAY_OUT", amount: 500, reason: "Bought napkins" },
  });
  check("a pay-out is recorded as money leaving", num(movement.body.data.amount) === -500, movement.body?.data);

  const badAdjustment = await api(`/admin/registers/${sessionId}/movements`, {
    method: "POST",
    token: adminToken,
    body: { type: "ADJUSTMENT", amount: 100 },
  });
  check("an adjustment without a reason is refused", badAdjustment.status === 400, badAdjustment.body?.error);

  const beforeClose = await api(`/admin/registers/${sessionId}`, { token: adminToken });
  const expected = num(beforeClose.body.data.expectedCash);
  // 5000 float + 1000 + 1000 (refused `capture`, then collected properly)
  //   + 1000 (captured with no drawer, then adopted) + 800 + 1200 + 1000
  //   (idempotency order was never collected) + 1000 cashier sale
  //   - 100 cashier refund - 500 pay-out
  check(
    "expected cash is derived from the movements",
    expected === 5000 + 1000 + 1000 + 1000 + 800 + 1200 + 1000 - 100 - 500,
    { expected },
  );

  const closed = await api(`/admin/registers/${sessionId}/close`, {
    method: "POST",
    token: adminToken,
    body: { countedCash: expected - 250, notes: "Short by 250" },
  });
  check("closing records the variance", num(closed.body.data.variance) === -250, closed.body?.data);
  check("negative variance means short", num(closed.body.data.countedCash) < num(closed.body.data.expectedCash), closed.body?.data);

  const closeAgain = await api(`/admin/registers/${sessionId}/close`, {
    method: "POST",
    token: adminToken,
    body: { countedCash: 100 },
  });
  check("a closed session cannot be closed again", closeAgain.status === 409, closeAgain.body?.error);

  const reconciled = await api(`/admin/registers/${sessionId}/reconcile`, {
    method: "POST",
    token: adminToken,
    body: { notes: "Accepted, spoke to cashier" },
  });
  check("a manager reconciles the variance", reconciled.body?.data?.status === "RECONCILED", reconciled.body);

  const closedMovement = await api(`/admin/registers/${sessionId}/movements`, {
    method: "POST",
    token: adminToken,
    body: { type: "PAY_IN", amount: 100 },
  });
  check("a closed session takes no more movements", closedMovement.status === 409, closedMovement.body?.error);

  // ================= NOTIFICATIONS =================
  // Capture the customer's own card payment so there is a real recipient for
  // the notification, then drain the outbox and assert it arrived.
  const captureSelf = await api(`/admin/payments/${selfPay.body.data.paymentId}/capture`, {
    method: "POST",
    token: adminToken,
    body: {},
  });
  check("the customer's card payment captures", captureSelf.body?.data?.payment?.status === "CAPTURED", captureSelf.body);

  // One cycle claims at most WORKER_BATCH_SIZE events, oldest first, and
  // handlers enqueue more (`payment.captured` raises `finance.payment_captured`
  // before it notifies). So drain until the queue stops yielding, rather than
  // once: a single cycle only reached this capture while the suite happened to
  // sit under one batch.
  let drained = null;
  for (let cycle = 0; cycle < 10; cycle++) {
    drained = await fetch(`${BASE}/api/internal/jobs/outbox`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.E2E_CRON_SECRET ?? "phase2-test-secret"}` },
    });
    if (drained.status !== 200) break;
    const body = await drained.clone().json();
    if ((body?.data?.claimed ?? 0) === 0) break;
  }
  check("the outbox drains", drained.status === 200, drained.status);

  const gotNotification = await waitFor(
    async () =>
      (await prisma.notification.count({ where: { userId: customerId, type: "payment.captured" } })) > 0,
  );
  check("the customer is told their payment went through", gotNotification, { gotNotification });

  const notification = await prisma.notification.findFirst({
    where: { userId: customerId, type: "payment.captured" },
  });
  check("the notification points back at the order", notification?.referenceId === custOrderId, notification);
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { contains: tag } }, select: { id: true } });
  const ids = [...new Set([...created.userIds, ...users.map((u) => u.id)])];
  // Every E2E7 branch, not just this run's: the branch delete at the end of
  // cleanup is by code prefix, so a run that died mid-way leaves a branch whose
  // orders nobody clears, and the next run's cleanup dies on the foreign key
  // instead of tidying up after it.
  const strays = await prisma.branch.findMany({ where: { code: { startsWith: "E2E7" } }, select: { id: true } });
  const branchIds = [...new Set([...created.branchIds, ...strays.map((b) => b.id)])];

  const orders = await prisma.order.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);

  await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.cashMovement.deleteMany({ where: { session: { branchId: { in: branchIds } } } });
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.cashRegisterSession.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.paymentWebhookEvent.deleteMany({ where: { eventId: { contains: String(stamp) } } });

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
  await prisma.rolePermission.deleteMany({ where: { role: { name: { contains: String(stamp) } } } });
  await prisma.role.deleteMany({ where: { name: { contains: String(stamp) } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: "E2E7" } } });
  await prisma.setting.deleteMany({});

  const leftovers = {
    users: await prisma.user.count(),
    branches: await prisma.branch.count(),
    orders: await prisma.order.count(),
    payments: await prisma.payment.count(),
    refunds: await prisma.refund.count(),
    registers: await prisma.cashRegisterSession.count(),
    movements: await prisma.cashMovement.count(),
    webhookEvents: await prisma.paymentWebhookEvent.count(),
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
