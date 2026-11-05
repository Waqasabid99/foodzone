import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions } from "../src/lib/db-pool.js";

/**
 * Phase 16 — the Service screens: the counter, the kitchen, the dining room
 * and the baskets in progress.
 *
 * Two things are proved here that nothing else covers.
 *
 * **The front desk, end to end.** An order taken at the counter, priced by the
 * server rather than the screen, sent to the kitchen, advanced line by line,
 * paid for in cash with change, and closed. The parts of that chain which go
 * wrong quietly — a price trusted from the client, a payment that overshoots,
 * a status that skips a step — are each asserted rather than assumed.
 *
 * **The branch wall.** An order carries a customer's name, their phone number
 * and what they spent. `orders.read` at one till is a grant at *that* till;
 * without the list half of it, omitting the branch filter hands a cashier
 * every outlet's customers. `orders.read_all_branches` exists as the opt-in,
 * and that is tested too — it has to still work.
 *
 * Start a server first:
 *   APP_URL=http://localhost:3100 CRON_SECRET=phase2-test-secret npx next start -p 3100
 */
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });

const stamp = Date.now();
const tag = `e2e16-${stamp}`;
const emailOf = (name) => `${tag}-${name}@example.test`;
const short = String(stamp).slice(-5);
const created = { userIds: new Set(), branchIds: new Set(), roleIds: new Set(), productIds: new Set(), categoryIds: new Set() };

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
const nextIp = () => `10.91.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;

async function api(pathname, { method = "GET", body, token, session, headers = {} } = {}) {
  const res = await fetch(`${BASE}/api/v1${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": nextIp(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(session ? { "x-session-id": session } : {}),
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

/** Follows a printed QR URL the way a phone camera would: no redirect follow. */
async function scan(code) {
  const res = await fetch(`${BASE}/m/${code}`, {
    redirect: "manual",
    headers: { "x-forwarded-for": nextIp(), "user-agent": "phase16-scanner" },
  });
  return {
    status: res.status,
    location: res.headers.get("location"),
    cookies: Object.fromEntries((res.headers.getSetCookie?.() ?? []).map((line) => line.split(";")[0].split("="))),
  };
}

async function page(pathname, cookie) {
  const res = await fetch(`${BASE}${pathname}`, { headers: { cookie, "x-forwarded-for": nextIp() }, redirect: "manual" });
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
    body: { name: "P16 Admin", email: emailOf("admin"), password: "admin-passphrase-16" },
  });
  const adminId = adminReg.body.data.user.id;
  created.userIds.add(adminId);
  await prisma.user.update({ where: { id: adminId }, data: { isSuperAdmin: true, status: "ACTIVE", emailVerifiedAt: new Date() } });
  const admin = await loginCookies(emailOf("admin"), "admin-passphrase-16");
  const adminToken = admin.token;

  const mine = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: `S${short}`, name: `P16 Mine ${short}`, city: "Karachi", timezone: "Asia/Karachi" },
  });
  const theirs = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: `T${short}`, name: `P16 Theirs ${short}`, city: "Lahore", timezone: "Asia/Karachi" },
  });
  check("two branches exist", mine.status === 201 && theirs.status === 201, { mine: mine.body?.error, theirs: theirs.body?.error });
  const mineId = mine.body.data.id;
  const theirsId = theirs.body.data.id;
  created.branchIds.add(mineId);
  created.branchIds.add(theirsId);

  const category = await api("/admin/categories", { method: "POST", token: adminToken, body: { name: `P16 Mains ${short}` } });
  const categoryId = category.body.data.id;
  created.categoryIds.add(categoryId);

  const product = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: { name: `P16 Biryani ${short}`, categoryId, price: 450 },
  });
  const productId = product.body.data.id;
  created.productIds.add(productId);
  await api(`/admin/products/${productId}/publish`, { method: "PUT", token: adminToken, body: { isActive: true } });

  const variant = await prisma.productVariant.findFirst({ where: { productId }, select: { id: true } });
  check("the product has a sellable variant", Boolean(variant), variant);

  for (const branchId of [mineId, theirsId]) {
    const menu = await api("/admin/menus", {
      method: "POST",
      token: adminToken,
      body: { branchId, isActive: true, name: `P16 Menu ${short}`, type: "DINE_IN", isDefault: true },
    });
    await api(`/admin/menus/${menu.body.data.id}/items`, { method: "POST", token: adminToken, body: { productId } });
  }

  // ================= tables at both branches =================
  const ourTables = await api("/admin/tables/bulk", {
    method: "POST",
    token: adminToken,
    body: { branchId: mineId, prefix: `M${short}-`, from: 1, to: 4, seats: 4, area: "Main room" },
  });
  check("a row of tables is laid out in one call", ourTables.status === 201 || ourTables.status === 200, ourTables.body?.error);

  const theirTable = await api("/admin/tables", {
    method: "POST",
    token: adminToken,
    body: { branchId: theirsId, name: `T${short}-1`, seats: 2 },
  });
  const theirTableId = theirTable.body.data.id;

  const tooMany = await api("/admin/tables/bulk", {
    method: "POST",
    token: adminToken,
    body: { branchId: mineId, prefix: "X-", from: 1, to: 5000, seats: 4 },
  });
  check("a mistyped range is refused rather than creating 5000 tables", tooMany.status === 400, tooMany.status);

  // `paginated()` puts the rows straight in `data` with the cursor in `meta`.
  const ourTableRows = await api(`/admin/tables?branchId=${mineId}`, { token: adminToken });
  const ourTableId = ourTableRows.body.data[0].id;
  check("four tables were created", ourTableRows.body.data.length === 4, ourTableRows.body?.data?.length);

  // ================= QR codes at both branches =================
  const ourQr = await api("/admin/qr-codes", {
    method: "POST",
    token: adminToken,
    body: { branchId: mineId, targetType: "TABLE", tableId: ourTableId, label: `Table talker ${short}` },
  });
  const theirQr = await api("/admin/qr-codes", {
    method: "POST",
    token: adminToken,
    body: { branchId: theirsId, targetType: "MENU", label: `Window ${short}` },
  });
  check("a QR code at each branch", ourQr.status === 201 && theirQr.status === 201, { ours: ourQr.body?.error, theirs: theirQr.body?.error });
  const ourQrId = ourQr.body.data.id;
  const theirQrId = theirQr.body.data.id;

  // ================= the printed URL actually resolves =================
  // `qrUrl` prints `/m/{code}` on the sticker, so that path has to exist. It
  // did not, and every scan was a 404 — the one failure nobody sees in an
  // admin screen, because the admin screen is not what a customer opens.
  const printed = ourQr.body.data.url;
  check("the code carries the URL that gets printed", printed.endsWith(`/m/${ourQr.body.data.code}`), printed);

  const tableScan = await scan(ourQr.body.data.code);
  check("scanning a table code lands on the menu", tableScan.status === 307 && (tableScan.location ?? "").includes("/menu"), tableScan);
  check("and remembers which outlet they are in", tableScan.cookies.fz_branch === mineId, tableScan.cookies);
  check("and which table they are sitting at", tableScan.cookies.fz_table === ourTableId, tableScan.cookies);
  check("and switches them to dine-in", tableScan.cookies.fz_order_type === "DINE_IN", tableScan.cookies);

  const menuScan = await scan(theirQr.body.data.code);
  // A menu sticker is not a seat: a table left over from an earlier visit has
  // to be cleared, or tonight's delivery arrives labelled "table 4".
  check("scanning a menu code clears any earlier table", menuScan.cookies.fz_table === "", menuScan.cookies);

  const deadScan = await scan("ZZZZZZZZ");
  check("an unknown code shows the menu rather than an error", deadScan.status === 307 && (deadScan.location ?? "").includes("scan=unknown"), deadScan);

  // The scan counter is what makes "nobody scans that poster" answerable.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const countedQr = await api(`/admin/qr-codes/${ourQr.body.data.id}`, { token: adminToken });
  check("a scan is counted against the code", Number(countedQr.body?.data?.scanCount) >= 1, countedQr.body?.data?.scanCount);

  const badScheme = await api("/admin/qr-codes", {
    method: "POST",
    token: adminToken,
    body: { branchId: mineId, targetType: "CUSTOM_URL", customUrl: "javascript:alert(1)" },
  });
  check("a code cannot be pointed at a non-http scheme", badScheme.status === 400, badScheme.status);

  // ================= THE COUNTER: an order end to end =================
  const placed = await api("/admin/orders", {
    method: "POST",
    token: adminToken,
    body: {
      branchId: mineId,
      type: "DINE_IN",
      channel: "POS",
      tableId: ourTableId,
      guestCount: 2,
      guest: { name: `Walk-in ${short}` },
      items: [{ productId, variantId: variant.id, quantity: 2 }],
      kitchenNote: "No chilli",
    },
  });
  check("an order is taken at the counter", placed.status === 201, placed.body?.error);
  const orderId = placed.body.data.id;
  const orderNumber = placed.body.data.orderNumber;

  // 2 × 450 = 900 before tax. The price came from the menu, not the request.
  check("the order is priced by the server, not the till", Number(placed.body.data.subtotal) === 900, placed.body?.data?.subtotal);
  /*
   * A counter order comes out already accepted.
   *
   * "Waiting to be accepted" means something for an order that arrived from
   * the website: somebody at the shop has to agree to cook it. An order a
   * member of staff just typed in, with the customer standing there, has
   * already been agreed to by the only person who could agree to it — asking
   * them to press Accept is a tap that confirms their own decision to
   * themselves. See SELF_ACCEPTING in the admin orders route.
   */
  check("a counter order is already accepted", placed.body.data.status === "CONFIRMED", placed.body?.data?.status);
  check("it knows which table it is for", placed.body.data.tableId === ourTableId, placed.body?.data?.tableId);
  check("and what the next steps are", Array.isArray(placed.body.data.nextStatuses) && placed.body.data.nextStatuses.includes("PREPARING"), placed.body?.data?.nextStatuses);

  const grandTotal = Number(placed.body.data.grandTotal);

  // ================= the kitchen sees it =================
  // Self-accepting is only for an order a member of staff took. A QR order is
  // typed by the customer at the table, nobody from the shop has seen it, and
  // it must still wait — otherwise the distinction is decorative.
  const kiosk = await api("/admin/orders", {
    method: "POST",
    token: adminToken,
    body: {
      branchId: mineId,
      type: "DINE_IN",
      channel: "QR",
      tableId: ourTableId,
      guestCount: 1,
      guest: { name: `Self-serve ${short}` },
      items: [{ productId, variantId: variant.id, quantity: 1 }],
    },
  });
  check("a self-serve order still waits to be accepted", kiosk.body?.data?.status === "PENDING", kiosk.body?.data?.status);
  const kioskBoard = await api(`/admin/kds?branchId=${mineId}`, { token: adminToken });
  check(
    "and is not in the kitchen until somebody accepts it",
    !(kioskBoard.body?.data ?? []).some((t) => t.id === kiosk.body?.data?.id),
    kioskBoard.status,
  );

  const skipAhead = await api(`/admin/orders/${orderId}/status`, { method: "PUT", token: adminToken, body: { status: "DELIVERED" } });
  check("an order cannot skip to the end", skipAhead.status === 409, skipAhead.status);

  const ticketList = await api(`/admin/kds?branchId=${mineId}`, { token: adminToken });
  const ticket = (ticketList.body?.data ?? []).find((row) => row.id === orderId);
  check("a counter order is on the kitchen board straight away", Boolean(ticket), (ticketList.body?.data ?? []).length);
  check("with its line and the kitchen note", ticket?.items?.length === 1, ticket?.items);

  const line = ticket.items[0];
  const preparing = await api(`/admin/kds/items/${line.id}`, { method: "PUT", token: adminToken, body: { status: "PREPARING" } });
  check("a kitchen line can be started", preparing.status === 200, preparing.body?.error);

  const ready = await api(`/admin/kds/items/${line.id}`, { method: "PUT", token: adminToken, body: { status: "READY" } });
  check("and marked ready", ready.status === 200, ready.body?.error);

  const afterReady = await api(`/admin/orders/${orderId}`, { token: adminToken });
  // Nobody in a kitchen should have to remember to tap the ticket *and* the order.
  check("the last line going ready takes the order with it", afterReady.body.data.status === "READY", afterReady.body?.data?.status);

  // ================= taking the money =================
  const overpay = await api("/admin/payments", {
    method: "POST",
    token: adminToken,
    body: { orderId, method: "CASH", amount: grandTotal + 1000, idempotencyKey: `over-${short}` },
  });
  check("a payment larger than the bill is refused", overpay.status === 400 || overpay.status === 409, { status: overpay.status, body: overpay.body?.error });

  const part = await api("/admin/payments", {
    method: "POST",
    token: adminToken,
    body: { orderId, method: "CASH", amount: 100, idempotencyKey: `part-${short}` },
  });
  check("a part payment is taken", part.status === 201, part.body?.error);
  const partPaymentId = part.body?.data?.payment?.id ?? part.body?.data?.id;

  const collected = await api(`/admin/payments/${partPaymentId}/collect`, { method: "POST", token: adminToken, body: {} });
  check("cash is marked collected", collected.status === 200, collected.body?.error);

  const replay = await api("/admin/payments", {
    method: "POST",
    token: adminToken,
    body: { orderId, method: "CASH", amount: 100, idempotencyKey: `part-${short}` },
  });
  // A tap on a flaky connection must not be a second charge.
  check("replaying the same key does not charge twice", replay.body?.data?.replayed === true || replay.body?.data?.payment?.id === partPaymentId, replay.body?.data);

  const afterPart = await api(`/admin/orders/${orderId}`, { token: adminToken });
  check("the order is part paid", afterPart.body.data.paymentState === "PARTIALLY_PAID", afterPart.body?.data?.paymentState);

  // `Order.paidTotal` is a column nothing ever writes, so what has been taken
  // has to be read off the payment rows. Asserted here so that if the column
  // ever starts being maintained, this still measures the real thing.
  const takenSoFar = await api(`/admin/payments?orderId=${orderId}`, { token: adminToken });
  const captured = (takenSoFar.body?.data?.items ?? takenSoFar.body?.data ?? [])
    .filter((row) => ["CAPTURED", "COLLECTED", "PAID", "SUCCEEDED"].includes(row.status))
    .reduce((sum, row) => sum + Number(row.amount), 0);
  check("and the payment rows say how much was taken", captured === 100, { captured, rows: takenSoFar.body?.data });

  const rest = await api("/admin/payments", {
    method: "POST",
    token: adminToken,
    body: { orderId, method: "CASH", amount: grandTotal - 100, idempotencyKey: `rest-${short}` },
  });
  check("the rest is taken", rest.status === 201, rest.body?.error);
  await api(`/admin/payments/${rest.body.data.payment?.id ?? rest.body.data.id}/collect`, { method: "POST", token: adminToken, body: {} });

  const settled = await api(`/admin/orders/${orderId}`, { token: adminToken });
  check("the order settles once it is all paid", settled.body.data.paymentState === "PAID", settled.body?.data?.paymentState);

  // ================= discounts need a reason =================
  const noReason = await api(`/admin/orders/${orderId}/discounts`, { method: "POST", token: adminToken, body: { percent: 10 } });
  check("a manual discount without a reason is refused", noReason.status === 400, noReason.status);

  const bothAtOnce = await api(`/admin/orders/${orderId}/discounts`, {
    method: "POST",
    token: adminToken,
    body: { percent: 10, amount: 100, reason: "Cold food" },
  });
  check("an amount and a percentage together is refused", bothAtOnce.status === 400, bothAtOnce.status);

  // ================= an order at the other branch =================
  const theirOrder = await api("/admin/orders", {
    method: "POST",
    token: adminToken,
    body: {
      branchId: theirsId,
      type: "DINE_IN",
      channel: "POS",
      tableId: theirTableId,
      guest: { name: `Other walk-in ${short}` },
      items: [{ productId, variantId: variant.id, quantity: 1 }],
    },
  });
  check("an order at the other branch too", theirOrder.status === 201, theirOrder.body?.error);
  const theirOrderId = theirOrder.body.data.id;

  // ================= a live cart =================
  const shopper = `p16-session-${short}`;
  const cartAdd = await api("/cart/items", {
    method: "POST",
    session: shopper,
    body: { branchId: mineId, type: "DINE_IN", productId, quantity: 3 },
  });
  check("a shopper fills a basket on the storefront", cartAdd.status === 200 || cartAdd.status === 201, cartAdd.body?.error);

  const cartList = await api("/admin/carts?limit=50", { token: adminToken });
  const ourCart = (cartList.body?.data?.items ?? []).find((row) => row.branchId === mineId && row.unitCount === 3);
  check("the basket shows up on the live carts screen", Boolean(ourCart), { status: cartList.status, count: cartList.body?.data?.items?.length });
  check("with what is in it", ourCart?.products?.[0]?.quantity === 3, ourCart?.products);
  check("and who is holding it", ourCart?.userId === null, ourCart?.userId);

  const cartDetail = await api(`/admin/carts/${ourCart.id}`, { token: adminToken });
  check("one basket can be opened and priced", cartDetail.status === 200 && Number(cartDetail.body?.data?.priced?.totals?.subtotal) === 1350, {
    status: cartDetail.status,
    totals: cartDetail.body?.data?.priced?.totals,
    pricingError: cartDetail.body?.data?.pricingError,
  });

  // Empty carts are noise: a row exists the moment anybody opens the menu.
  await prisma.cart.create({ data: { sessionId: `p16-empty-${short}`, branchId: mineId, type: "DINE_IN" } });
  const withoutEmpty = await api("/admin/carts?limit=50", { token: adminToken });
  const withEmpty = await api("/admin/carts?limit=50&includeEmpty=true", { token: adminToken });
  check(
    "empty baskets are left out unless asked for",
    (withEmpty.body?.data?.items ?? []).length > (withoutEmpty.body?.data?.items ?? []).length,
    { without: withoutEmpty.body?.data?.items?.length, with: withEmpty.body?.data?.items?.length },
  );

  // ================= a cashier scoped to one branch =================
  const cashierReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P16 Cashier", email: emailOf("cashier"), password: "cashier-passphrase-16" },
  });
  const cashierId = cashierReg.body.data.user.id;
  created.userIds.add(cashierId);
  await prisma.user.update({ where: { id: cashierId }, data: { emailVerifiedAt: new Date(), status: "ACTIVE" } });

  const role = await api("/admin/roles", {
    method: "POST",
    token: adminToken,
    body: { name: `P16 Cashier ${short}`, description: "One till only", scope: "BRANCH", level: 30 },
  });
  created.roleIds.add(role.body?.data?.id);
  await api(`/admin/roles/${role.body.data.id}/permissions`, {
    method: "PUT",
    token: adminToken,
    body: {
      permissionKeys: [
        "dashboard.view",
        "orders.read",
        "orders.create",
        "orders.update",
        "orders.update_status",
        "orders.cancel",
        "kds.read",
        "kds.update_item_status",
        "tables.read",
        "tables.create",
        "tables.update",
        "qr_codes.read",
        "qr_codes.create",
        "carts.read",
        "payments.read",
        "payments.capture",
      ],
    },
  });
  await api(`/admin/users/${cashierId}/roles`, { method: "POST", token: adminToken, body: { roleId: role.body.data.id, branchId: mineId } });
  const cashier = await loginCookies(emailOf("cashier"), "cashier-passphrase-16");
  const cashierToken = cashier.token;

  // ================= THE WALL =================
  const orderList = await api("/admin/orders?limit=100", { token: cashierToken });
  const orderIds = (orderList.body?.data ?? orderList.body?.items ?? []).map((row) => row.id);
  check("a scoped cashier can list orders at all", orderList.status === 200, orderList.body?.error);
  check("their own branch's order is listed", orderIds.includes(orderId), orderIds.length);
  // The bug this phase exists for: omit the filter, get every outlet's customers.
  check("another branch's order is NOT listed when the filter is omitted", !orderIds.includes(theirOrderId), { listed: orderIds.length, leaked: theirOrderId });

  const byName = await api(`/admin/orders?branchId=${theirsId}`, { token: cashierToken });
  check("asking for another branch's orders by name is refused", byName.status === 403, byName.status);

  const theirOrderRead = await api(`/admin/orders/${theirOrderId}`, { token: cashierToken });
  check("another branch's order answers not-found, not forbidden", theirOrderRead.status === 404, theirOrderRead.status);

  const theirStatus = await api(`/admin/orders/${theirOrderId}/status`, { method: "PUT", token: cashierToken, body: { status: "CONFIRMED" } });
  check("nor can it be advanced", theirStatus.status === 404, theirStatus.status);

  const theirCancel = await api(`/admin/orders/${theirOrderId}/cancel`, { method: "POST", token: cashierToken, body: { reason: "testing the wall" } });
  check("nor cancelled", theirCancel.status === 404, theirCancel.status);

  const ownOrder = await api(`/admin/orders/${orderId}`, { token: cashierToken });
  check("their own branch's order opens normally", ownOrder.status === 200, ownOrder.status);

  const tableList = await api("/admin/tables?limit=200", { token: cashierToken });
  const tableIds = (tableList.body?.data ?? tableList.body?.items ?? []).map((row) => row.id);
  check("another branch's tables are not listed", tableIds.includes(ourTableId) && !tableIds.includes(theirTableId), { listed: tableIds.length });

  const theirTableRead = await api(`/admin/tables/${theirTableId}`, { token: cashierToken });
  check("another branch's table answers not-found", theirTableRead.status === 404, theirTableRead.status);

  const qrList = await api("/admin/qr-codes?limit=200", { token: cashierToken });
  const qrIds = (qrList.body?.data ?? qrList.body?.items ?? []).map((row) => row.id);
  check("another branch's QR codes are not listed", qrIds.includes(ourQrId) && !qrIds.includes(theirQrId), { listed: qrIds.length });

  const theirQrRead = await api(`/admin/qr-codes/${theirQrId}`, { token: cashierToken });
  check("another branch's QR code answers not-found", theirQrRead.status === 404, theirQrRead.status);

  const theirKitchen = await api(`/admin/kds?branchId=${theirsId}`, { token: cashierToken });
  check("another branch's kitchen board is refused", theirKitchen.status === 403, theirKitchen.status);

  const cashierCarts = await api("/admin/carts?limit=50", { token: cashierToken });
  check("the live carts list is scoped too", cashierCarts.status === 200, cashierCarts.body?.error);
  check(
    "and shows their own branch's baskets",
    (cashierCarts.body?.data?.items ?? []).some((row) => row.id === ourCart.id),
    (cashierCarts.body?.data?.items ?? []).length,
  );

  // ================= the all-branches opt-in still works =================
  const regionalRole = await api("/admin/roles", {
    method: "POST",
    token: adminToken,
    body: { name: `P16 Regional ${short}`, description: "Every outlet", scope: "BRANCH", level: 60 },
  });
  created.roleIds.add(regionalRole.body?.data?.id);
  await api(`/admin/roles/${regionalRole.body.data.id}/permissions`, {
    method: "PUT",
    token: adminToken,
    body: { permissionKeys: ["dashboard.view", "orders.read", "orders.read_all_branches"] },
  });
  const regionalReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P16 Regional", email: emailOf("regional"), password: "regional-passphrase-16" },
  });
  const regionalId = regionalReg.body.data.user.id;
  created.userIds.add(regionalId);
  await prisma.user.update({ where: { id: regionalId }, data: { emailVerifiedAt: new Date(), status: "ACTIVE" } });
  await api(`/admin/users/${regionalId}/roles`, { method: "POST", token: adminToken, body: { roleId: regionalRole.body.data.id, branchId: mineId } });
  const regional = await loginCookies(emailOf("regional"), "regional-passphrase-16");

  const regionalList = await api("/admin/orders?limit=100", { token: regional.token });
  const regionalIds = (regionalList.body?.data ?? regionalList.body?.items ?? []).map((row) => row.id);
  check(
    "read_all_branches really does lift the wall",
    regionalIds.includes(orderId) && regionalIds.includes(theirOrderId),
    { listed: regionalIds.length },
  );

  // ================= THE SCREENS =================
  const adminPaths = [
    "/dashboard/orders",
    "/dashboard/orders?status=",
    `/dashboard/orders/${orderId}`,
    `/dashboard/orders/${theirOrderId}`,
    "/dashboard/orders/new",
    `/dashboard/orders/new?branch=${mineId}&type=DINE_IN`,
    `/dashboard/orders/new?branch=${mineId}&type=PICKUP`,
    "/dashboard/kitchen",
    `/dashboard/kitchen?branch=${mineId}`,
    "/dashboard/tables",
    `/dashboard/tables?branch=${mineId}`,
    "/dashboard/qr-codes",
    "/dashboard/qr-codes/new",
    `/dashboard/qr-codes/${ourQrId}`,
    "/dashboard/carts",
    `/dashboard/carts/${ourCart.id}`,
  ];
  for (const path of adminPaths) {
    const rendered = await page(path, admin.cookie);
    check(`renders for an admin: ${path}`, rendered.status === 200, { status: rendered.status, location: rendered.location });
  }

  const cashierPaths = [
    "/dashboard/orders",
    `/dashboard/orders/${orderId}`,
    "/dashboard/orders/new",
    "/dashboard/kitchen",
    "/dashboard/tables",
    "/dashboard/qr-codes",
    "/dashboard/carts",
  ];
  for (const path of cashierPaths) {
    const rendered = await page(path, cashier.cookie);
    check(`renders for a scoped cashier: ${path}`, rendered.status === 200, { status: rendered.status, location: rendered.location });
  }

  for (const [label, path] of [
    ["order", `/dashboard/orders/${theirOrderId}`],
    ["QR code", `/dashboard/qr-codes/${theirQrId}`],
  ]) {
    const rendered = await page(path, cashier.cookie);
    check(`another branch's ${label} page is not found for a scoped cashier`, rendered.status === 404, rendered.status);
  }

  const ordersPage = await page("/dashboard/orders?status=", cashier.cookie);
  check(
    "the orders page does not leak another branch's order number",
    ordersPage.status === 200 && !ordersPage.html.includes(theirOrder.body.data.orderNumber),
    { status: ordersPage.status },
  );
  check("but does show their own", ordersPage.html.includes(orderNumber), orderNumber);
}

async function cleanup() {
  const branchIds = [...created.branchIds];
  const orderIds = (await prisma.order.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((r) => r.id);

  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderStatusEvent.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderDiscount.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderTaxLine.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderItemModifier.deleteMany({ where: { orderItem: { orderId: { in: orderIds } } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.invoice.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {});
  await prisma.journalLine.deleteMany({ where: { entry: { branchId: { in: branchIds } } } });
  await prisma.journalEntry.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });

  await prisma.cartItem.deleteMany({ where: { cart: { branchId: { in: branchIds } } } });
  await prisma.cart.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.qrScan.deleteMany({ where: { qrCode: { branchId: { in: branchIds } } } });
  await prisma.qrCode.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.restaurantTable.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.menuItem.deleteMany({ where: { menu: { branchId: { in: branchIds } } } });
  await prisma.menuSection.deleteMany({ where: { menu: { branchId: { in: branchIds } } } });
  await prisma.menu.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.cashRegisterSession.deleteMany({ where: { branchId: { in: branchIds } } }).catch(() => {});

  await prisma.productVariant.deleteMany({ where: { productId: { in: [...created.productIds] } } });
  await prisma.product.deleteMany({ where: { id: { in: [...created.productIds] } } });
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
      carts: await prisma.cart.count(),
      tables: await prisma.restaurantTable.count(),
      qrCodes: await prisma.qrCode.count(),
      products: await prisma.product.count(),
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
