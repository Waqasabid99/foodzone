import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions } from "../src/lib/db-pool.js";

/**
 * Phase 15 — the Purchasing screens, and the branch wall behind them.
 *
 * Phase 11 already proves the money: a delivery posts stock, a bill becomes a
 * payable, a payment settles it. This proves the thing that arithmetic never
 * touches — **whose spend a scoped buyer can see** — and that every new screen
 * renders.
 *
 * The distinction the whole phase turns on is deliberate and is asserted both
 * ways:
 *
 *   * **Suppliers are company data.** One company negotiates one price list,
 *     and a branch buyer must be able to read it. Scoping suppliers per branch
 *     would hide from a manager who the company buys flour from, which is not
 *     a secret.
 *   * **Everything the supplier costs is branch data.** An order, a delivery
 *     and a payable each belong to one outlet, and a buyer who omits the
 *     branch filter must not be handed the company's whole spend.
 *
 * Start a server first:
 *   APP_URL=http://localhost:3100 CRON_SECRET=phase2-test-secret npx next start -p 3100
 */
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });

const stamp = Date.now();
const tag = `e2e15-${stamp}`;
const emailOf = (name) => `${tag}-${name}@example.test`;
const short = String(stamp).slice(-5);
const created = { userIds: new Set(), branchIds: new Set(), roleIds: new Set(), unitIds: new Set(), supplierIds: new Set(), itemIds: new Set() };

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

async function api(pathname, { method = "GET", body, token, headers = {} } = {}) {
  const res = await fetch(`${BASE}/api/v1${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": nextIp(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
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

/** Fetches a dashboard page as a signed-in browser would. */
async function page(pathname, cookie) {
  const res = await fetch(`${BASE}${pathname}`, {
    headers: { cookie, "x-forwarded-for": nextIp() },
    redirect: "manual",
  });
  const html = res.status === 200 ? await res.text() : "";
  return { status: res.status, location: res.headers.get("location"), html };
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

async function main() {
  // ================= SETUP =================
  const adminReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P15 Admin", email: emailOf("admin"), password: "admin-passphrase-15" },
  });
  const adminId = adminReg.body.data.user.id;
  created.userIds.add(adminId);
  await prisma.user.update({ where: { id: adminId }, data: { isSuperAdmin: true, status: "ACTIVE", emailVerifiedAt: new Date() } });
  const admin = await loginCookies(emailOf("admin"), "admin-passphrase-15");
  const adminToken = admin.token;

  const mine = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: `P${short}`, name: `P15 Mine ${short}`, city: "Karachi", timezone: "Asia/Karachi" },
  });
  const theirs = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: `Q${short}`, name: `P15 Theirs ${short}`, city: "Lahore", timezone: "Asia/Karachi" },
  });
  check("two branches exist", mine.status === 201 && theirs.status === 201, { mine: mine.body, theirs: theirs.body });
  const mineId = mine.body.data.id;
  const theirsId = theirs.body.data.id;
  created.branchIds.add(mineId);
  created.branchIds.add(theirsId);

  const unit = await api("/admin/units", {
    method: "POST",
    token: adminToken,
    body: { code: `KG${short}`, name: "Kilogram", type: "WEIGHT", precision: 3 },
  });
  const unitId = unit.body.data.id;
  created.unitIds.add(unitId);

  const makeLocation = async (branchId, code) =>
    api("/admin/stock-locations", {
      method: "POST",
      token: adminToken,
      body: { branchId, name: `Store ${code}`, code: `${code}${short}`, type: "MAIN_STORE", isDefault: true },
    });
  const ourLocation = (await makeLocation(mineId, "MINE")).body.data.id;
  const theirLocation = (await makeLocation(theirsId, "THRS")).body.data.id;

  const item = await api("/admin/inventory-items", {
    method: "POST",
    token: adminToken,
    body: { name: `P15 Rice ${short}`, uomId: unitId, type: "RAW_MATERIAL", costingMethod: "WEIGHTED_AVERAGE" },
  });
  const itemId = item.body.data.id;
  created.itemIds.add(itemId);

  const supplier = await api("/admin/suppliers", {
    method: "POST",
    token: adminToken,
    body: { code: `SUP${short}`, name: `P15 Grain Co ${short}`, paymentTermDays: 30 },
  });
  check("a supplier is created", supplier.status === 201, supplier.body);
  const supplierId = supplier.body.data.id;
  created.supplierIds.add(supplierId);

  // ================= the price list =================
  const priced = await api(`/admin/suppliers/${supplierId}/items`, {
    method: "PUT",
    token: adminToken,
    body: { itemId, unitPrice: 250, uomId: unitId, isPreferred: true, leadTimeDays: 2 },
  });
  check("an item goes on the supplier's price list", priced.status === 200, priced.body);

  const rePriced = await api(`/admin/suppliers/${supplierId}/items`, {
    method: "PUT",
    token: adminToken,
    body: { itemId, unitPrice: 275, uomId: unitId },
  });
  check("re-sending a line after a price rise updates it rather than failing", rePriced.status === 200, rePriced.body);
  check("and the new price is what is stored", Number(rePriced.body?.data?.unitPrice) === 275, rePriced.body?.data);

  // ================= orders at both branches =================
  const makeOrder = async (branchId) =>
    api("/admin/purchase-orders", {
      method: "POST",
      token: adminToken,
      body: { branchId, supplierId, items: [{ itemId, quantity: 10, unitPrice: 275, taxRate: 17 }] },
    });

  const ourOrder = await makeOrder(mineId);
  const theirOrder = await makeOrder(theirsId);
  check("an order at each branch", ourOrder.status === 201 && theirOrder.status === 201, { ours: ourOrder.body, theirs: theirOrder.body });
  const ourOrderId = ourOrder.body.data.id;
  const theirOrderId = theirOrder.body.data.id;

  // 10 × 275 = 2750, +17% = 3217.50. Derived by the server, never taken from
  // the client — the same arithmetic the form previews.
  check("the order total is derived, not trusted", Number(ourOrder.body?.data?.grandTotal) === 3217.5, ourOrder.body?.data);
  check("an order moves no stock", (await prisma.stockLevel.count({ where: { itemId } })) === 0);

  for (const id of [ourOrderId, theirOrderId]) {
    await api(`/admin/purchase-orders/${id}/approve`, { method: "POST", token: adminToken, body: {} });
    await api(`/admin/purchase-orders/${id}/send`, { method: "POST", token: adminToken, body: {} });
  }

  // ================= deliveries at both branches =================
  const makeReceipt = async (locationId, purchaseOrderId, poLineId) =>
    api("/admin/goods-receipts", {
      method: "POST",
      token: adminToken,
      body: {
        locationId,
        supplierId,
        purchaseOrderId,
        items: [{ itemId, purchaseOrderItemId: poLineId, quantity: 10, rejectedQuantity: 2, unitCost: 275, uomId: unitId }],
        landedCost: 100,
      },
    });

  const ourReceipt = await makeReceipt(ourLocation, ourOrderId, ourOrder.body.data.items[0].id);
  const theirReceipt = await makeReceipt(theirLocation, theirOrderId, theirOrder.body.data.items[0].id);
  check("a delivery at each branch", ourReceipt.status === 201 && theirReceipt.status === 201, { ours: ourReceipt.body, theirs: theirReceipt.body });
  const ourReceiptId = ourReceipt.body.data.id;
  const theirReceiptId = theirReceipt.body.data.id;

  // 8 accepted × 275 = 2200, + 100 freight = 2300.
  check("rejected stock is not priced", Number(ourReceipt.body?.data?.subtotal) === 2200, ourReceipt.body?.data);
  check("freight is part of what the delivery cost", Number(ourReceipt.body?.data?.grandTotal) === 2300, ourReceipt.body?.data);

  for (const id of [ourReceiptId, theirReceiptId]) {
    const posted = await api(`/admin/goods-receipts/${id}/post`, { method: "POST", token: adminToken, body: {} });
    check(`a delivery posts (${id === ourReceiptId ? "ours" : "theirs"})`, posted.status === 200, posted.body);
  }

  const level = await prisma.stockLevel.findFirst({ where: { itemId, locationId: ourLocation }, select: { quantity: true } });
  check("only the accepted quantity reaches stock", Number(level?.quantity) === 8, level);

  const reposted = await api(`/admin/goods-receipts/${ourReceiptId}/post`, { method: "POST", token: adminToken, body: {} });
  const levelAgain = await prisma.stockLevel.findFirst({ where: { itemId, locationId: ourLocation }, select: { quantity: true } });
  check("posting twice does not double the stock", reposted.status === 200 && Number(levelAgain?.quantity) === 8, { reposted: reposted.status, levelAgain });

  const orderAfter = await api(`/admin/purchase-orders/${ourOrderId}`, { token: adminToken });
  check("the order knows what arrived", Number(orderAfter.body?.data?.items?.[0]?.receivedQuantity) === 8, orderAfter.body?.data?.items?.[0]);
  check("and so does its outstanding figure", Number(orderAfter.body?.data?.items?.[0]?.outstandingQuantity) === 2, orderAfter.body?.data?.items?.[0]);

  const cancelAfterDelivery = await api(`/admin/purchase-orders/${ourOrderId}/cancel`, { method: "POST", token: adminToken, body: {} });
  check("an order that has taken a delivery cannot be cancelled", cancelAfterDelivery.status === 409, cancelAfterDelivery.status);

  // ================= bills at both branches =================
  const ourBill = await api(`/admin/supplier-bills/from-receipt/${ourReceiptId}`, {
    method: "POST",
    token: adminToken,
    body: { supplierInvoiceNumber: `INV-A-${short}` },
  });
  const theirBill = await api(`/admin/supplier-bills/from-receipt/${theirReceiptId}`, {
    method: "POST",
    token: adminToken,
    body: { supplierInvoiceNumber: `INV-B-${short}` },
  });
  check("a bill at each branch, built from the delivery", ourBill.status === 201 && theirBill.status === 201, { ours: ourBill.body, theirs: theirBill.body });
  const ourBillId = ourBill.body.data.id;
  const theirBillId = theirBill.body.data.id;

  check("the bill is for what the delivery cost, freight included", Number(ourBill.body?.data?.grandTotal) === 2300, ourBill.body?.data);
  check("the due date comes from the agreed terms", Boolean(ourBill.body?.data?.dueDate), ourBill.body?.data?.dueDate);

  const twice = await api(`/admin/supplier-bills/from-receipt/${ourReceiptId}`, { method: "POST", token: adminToken, body: {} });
  check("one delivery cannot be billed twice", twice.status === 409, twice.status);

  for (const id of [ourBillId, theirBillId]) {
    await api(`/admin/supplier-bills/${id}/approve`, { method: "POST", token: adminToken, body: {} });
  }

  const overpay = await api(`/admin/supplier-bills/${ourBillId}/payments`, {
    method: "POST",
    token: adminToken,
    body: { amount: 2300.01, method: "BANK_TRANSFER" },
  });
  check("a bill cannot be overpaid", overpay.status === 400, { status: overpay.status, body: overpay.body?.error });

  const part = await api(`/admin/supplier-bills/${ourBillId}/payments`, {
    method: "POST",
    token: adminToken,
    body: { amount: 300, method: "CASH", reference: `PART-${short}` },
  });
  check("a part payment leaves the bill part paid", part.body?.data?.status === "PARTIALLY_PAID", part.body?.data?.status);
  check("and says what is left", Number(part.body?.data?.outstanding) === 2000, part.body?.data?.outstanding);

  // ================= a buyer scoped to one branch =================
  const buyerReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P15 Buyer", email: emailOf("buyer"), password: "buyer-passphrase-15" },
  });
  const buyerId = buyerReg.body.data.user.id;
  created.userIds.add(buyerId);
  await prisma.user.update({ where: { id: buyerId }, data: { emailVerifiedAt: new Date(), status: "ACTIVE" } });

  const role = await api("/admin/roles", {
    method: "POST",
    token: adminToken,
    body: { name: `P15 Buyer ${short}`, description: "One outlet only", scope: "BRANCH", level: 40 },
  });
  created.roleIds.add(role.body?.data?.id);
  await api(`/admin/roles/${role.body.data.id}/permissions`, {
    method: "PUT",
    token: adminToken,
    body: {
      permissionKeys: [
        "dashboard.view",
        "suppliers.read",
        "suppliers.update",
        "purchase_orders.read",
        "purchase_orders.create",
        "purchase_orders.update",
        "purchase_orders.approve",
        "purchase_orders.send",
        "purchase_orders.cancel",
        "goods_receipts.read",
        "goods_receipts.create",
        "goods_receipts.approve",
        "supplier_bills.read",
        "supplier_bills.create",
        "supplier_bills.approve",
        "supplier_bills.record_payment",
      ],
    },
  });
  // Granted at ONE branch. Everything below asks for the other one.
  await api(`/admin/users/${buyerId}/roles`, { method: "POST", token: adminToken, body: { roleId: role.body.data.id, branchId: mineId } });
  const buyer = await loginCookies(emailOf("buyer"), "buyer-passphrase-15");
  const buyerToken = buyer.token;

  // ================= suppliers are deliberately shared =================
  const supplierToBuyer = await api(`/admin/suppliers/${supplierId}`, { token: buyerToken });
  check("a scoped buyer can read the company's suppliers", supplierToBuyer.status === 200, supplierToBuyer.status);
  check("including the agreed prices", (supplierToBuyer.body?.data?.items ?? []).length === 1, supplierToBuyer.body?.data?.items?.length);

  // ================= THE WALL: purchase orders =================
  const orderList = await api("/admin/purchase-orders?limit=100", { token: buyerToken });
  const orderIds = (orderList.body?.data?.items ?? []).map((row) => row.id);
  check("a scoped buyer can list orders at all", orderList.status === 200, orderList.body?.error);
  check("their own branch's order is listed", orderIds.includes(ourOrderId), orderIds.length);
  check("another branch's order is NOT listed when the filter is omitted", !orderIds.includes(theirOrderId), { listed: orderIds.length, leaked: theirOrderId });

  const ordersByName = await api(`/admin/purchase-orders?branchId=${theirsId}`, { token: buyerToken });
  check("asking for another branch's orders by name is refused", ordersByName.status === 403, ordersByName.status);

  const theirOrderRead = await api(`/admin/purchase-orders/${theirOrderId}`, { token: buyerToken });
  check("another branch's order answers not-found, not forbidden", theirOrderRead.status === 404, theirOrderRead.status);

  const theirOutstanding = await api(`/admin/purchase-orders/${theirOrderId}/outstanding`, { token: buyerToken });
  check("nor can its outstanding lines be read", theirOutstanding.status === 404, theirOutstanding.status);

  const theirApprove = await api(`/admin/purchase-orders/${theirOrderId}/approve`, { method: "POST", token: buyerToken, body: {} });
  check("nor approved", theirApprove.status === 404, theirApprove.status);

  const theirCancel = await api(`/admin/purchase-orders/${theirOrderId}/cancel`, { method: "POST", token: buyerToken, body: {} });
  check("nor cancelled", theirCancel.status === 404, theirCancel.status);

  const ourOrderRead = await api(`/admin/purchase-orders/${ourOrderId}`, { token: buyerToken });
  check("their own branch's order opens normally", ourOrderRead.status === 200, ourOrderRead.status);

  // ================= THE WALL: deliveries =================
  const receiptList = await api("/admin/goods-receipts?limit=100", { token: buyerToken });
  const receiptIds = (receiptList.body?.data?.items ?? []).map((row) => row.id);
  check("their own branch's delivery is listed", receiptIds.includes(ourReceiptId), receiptIds.length);
  check("another branch's delivery is NOT listed", !receiptIds.includes(theirReceiptId), { listed: receiptIds.length, leaked: theirReceiptId });

  const theirReceiptRead = await api(`/admin/goods-receipts/${theirReceiptId}`, { token: buyerToken });
  check("another branch's delivery answers not-found", theirReceiptRead.status === 404, theirReceiptRead.status);

  const theirPost = await api(`/admin/goods-receipts/${theirReceiptId}/post`, { method: "POST", token: buyerToken, body: {} });
  check("nor can it be posted", theirPost.status === 404, theirPost.status);

  // The branch is not in the body — it comes from the location — so this is the
  // case a plain body check would wave through.
  const receiveElsewhere = await api("/admin/goods-receipts", {
    method: "POST",
    token: buyerToken,
    body: { locationId: theirLocation, supplierId, items: [{ itemId, quantity: 1, unitCost: 275, uomId: unitId }] },
  });
  // Not found rather than forbidden, the same answer every other out-of-scope
  // record gives: a 403 would confirm the store room is real.
  check("stock cannot be received into another branch's store room", receiveElsewhere.status === 404, { status: receiveElsewhere.status, body: receiveElsewhere.body?.error });
  check("and nothing was created by the attempt", (await prisma.goodsReceipt.count({ where: { locationId: theirLocation, status: "DRAFT" } })) === 0);

  // ================= THE WALL: bills =================
  const billList = await api("/admin/supplier-bills?limit=100", { token: buyerToken });
  const billIds = (billList.body?.data?.items ?? []).map((row) => row.id);
  check("their own branch's bill is listed", billIds.includes(ourBillId), billIds.length);
  check("another branch's bill is NOT listed", !billIds.includes(theirBillId), { listed: billIds.length, leaked: theirBillId });

  const theirBillRead = await api(`/admin/supplier-bills/${theirBillId}`, { token: buyerToken });
  check("another branch's bill answers not-found", theirBillRead.status === 404, theirBillRead.status);

  const theirPay = await api(`/admin/supplier-bills/${theirBillId}/payments`, {
    method: "POST",
    token: buyerToken,
    body: { amount: 1, method: "CASH" },
  });
  check("nor can it be paid", theirPay.status === 404, theirPay.status);

  const theirBillFromReceipt = await api(`/admin/supplier-bills/from-receipt/${theirReceiptId}`, { method: "POST", token: buyerToken, body: {} });
  check("nor billed from another branch's delivery", theirBillFromReceipt.status === 404, theirBillFromReceipt.status);

  // ================= THE WALL: the ageing =================
  const ageing = await api("/admin/supplier-bills/ageing", { token: buyerToken });
  const agedBills = (ageing.body?.data?.rows ?? []).map((row) => row.billId);
  check("the payables ageing is scoped too", ageing.status === 200 && !agedBills.includes(theirBillId), { status: ageing.status, aged: agedBills });
  check("and still shows their own", agedBills.includes(ourBillId), agedBills);
  check("the ageing total is only their own branch's", Number(ageing.body?.data?.total) === 2000, ageing.body?.data?.total);

  const adminAgeing = await api("/admin/supplier-bills/ageing", { token: adminToken });
  check("an admin sees both branches in the ageing", (adminAgeing.body?.data?.rows ?? []).length >= 2, (adminAgeing.body?.data?.rows ?? []).length);

  // ================= THE SCREENS =================
  const adminPaths = [
    "/dashboard/suppliers",
    "/dashboard/suppliers/new",
    `/dashboard/suppliers/${supplierId}`,
    `/dashboard/suppliers/${supplierId}/edit`,
    "/dashboard/purchase-orders",
    "/dashboard/purchase-orders/new",
    `/dashboard/purchase-orders/new?supplier=${supplierId}`,
    `/dashboard/purchase-orders/${ourOrderId}`,
    `/dashboard/purchase-orders/${theirOrderId}`,
    "/dashboard/goods-receipts",
    "/dashboard/goods-receipts/new",
    `/dashboard/goods-receipts/new?order=${ourOrderId}`,
    `/dashboard/goods-receipts/${ourReceiptId}`,
    "/dashboard/supplier-bills",
    "/dashboard/supplier-bills/new",
    "/dashboard/supplier-bills/ageing",
    `/dashboard/supplier-bills/${ourBillId}`,
  ];

  for (const path of adminPaths) {
    const rendered = await page(path, admin.cookie);
    check(`renders for an admin: ${path}`, rendered.status === 200, { status: rendered.status, location: rendered.location });
  }

  const buyerPaths = [
    "/dashboard/suppliers",
    `/dashboard/suppliers/${supplierId}`,
    "/dashboard/purchase-orders",
    `/dashboard/purchase-orders/${ourOrderId}`,
    "/dashboard/goods-receipts",
    `/dashboard/goods-receipts/${ourReceiptId}`,
    "/dashboard/supplier-bills",
    `/dashboard/supplier-bills/${ourBillId}`,
    "/dashboard/supplier-bills/ageing",
  ];

  for (const path of buyerPaths) {
    const rendered = await page(path, buyer.cookie);
    check(`renders for a scoped buyer: ${path}`, rendered.status === 200, { status: rendered.status, location: rendered.location });
  }

  // A page for a record at the other branch is a 404, the same answer the API
  // gives — not a 403, which would confirm the id is real.
  for (const [label, path] of [
    ["order", `/dashboard/purchase-orders/${theirOrderId}`],
    ["delivery", `/dashboard/goods-receipts/${theirReceiptId}`],
    ["bill", `/dashboard/supplier-bills/${theirBillId}`],
  ]) {
    const rendered = await page(path, buyer.cookie);
    check(`another branch's ${label} page is not found for a scoped buyer`, rendered.status === 404, rendered.status);
  }

  const ordersPage = await page("/dashboard/purchase-orders?status=", buyer.cookie);
  check("the orders list page does not leak another branch's number", ordersPage.status === 200 && !ordersPage.html.includes(theirOrder.body.data.poNumber), {
    status: ordersPage.status,
  });
  const billsPage = await page("/dashboard/supplier-bills?status=", buyer.cookie);
  check("the bills list page does not leak another branch's number", billsPage.status === 200 && !billsPage.html.includes(theirBill.body.data.billNumber), {
    status: billsPage.status,
  });
}

async function cleanup() {
  const branchIds = [...created.branchIds];
  const supplierIds = [...created.supplierIds];
  const itemIds = [...created.itemIds];

  const billIds = (await prisma.supplierBill.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((row) => row.id);
  await prisma.billPayment.deleteMany({ where: { billId: { in: billIds } } });
  await prisma.journalLine.deleteMany({ where: { entry: { branchId: { in: branchIds } } } });
  await prisma.journalEntry.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.supplierBill.deleteMany({ where: { id: { in: billIds } } });

  await prisma.stockMovement.deleteMany({ where: { location: { branchId: { in: branchIds } } } });
  await prisma.stockBatch.deleteMany({ where: { location: { branchId: { in: branchIds } } } });
  await prisma.stockLevel.deleteMany({ where: { location: { branchId: { in: branchIds } } } });
  await prisma.goodsReceiptItem.deleteMany({ where: { goodsReceipt: { branchId: { in: branchIds } } } });
  await prisma.goodsReceipt.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrder: { branchId: { in: branchIds } } } });
  await prisma.purchaseOrder.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.stockLocation.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.supplierItem.deleteMany({ where: { supplierId: { in: supplierIds } } });
  await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
  await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
  await prisma.unitOfMeasure.deleteMany({ where: { id: { in: [...created.unitIds] } } });

  await prisma.outboxEvent.deleteMany({});
  await prisma.auditLog.deleteMany({ where: { actorId: { in: [...created.userIds] } } });
  await prisma.auditLog.deleteMany({ where: { branchId: { in: branchIds } } });
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
      suppliers: await prisma.supplier.count(),
      purchaseOrders: await prisma.purchaseOrder.count(),
      goodsReceipts: await prisma.goodsReceipt.count(),
      supplierBills: await prisma.supplierBill.count(),
      stockLevels: await prisma.stockLevel.count(),
      roles: await prisma.role.count(),
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
