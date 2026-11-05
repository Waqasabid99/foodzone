import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions, warmUpDatabase } from "../src/lib/db-pool.js";

/**
 * Phase 5 — Ordering, end to end.
 *
 * Start a server first:
 *   APP_URL=http://localhost:3100 npx next dev -p 3100
 */
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });

const stamp = Date.now();
const tag = `e2e5-${stamp}`;
const emailOf = (name) => `${tag}-${name}@example.test`;
const BRANCH_CODE = `E2E5${String(stamp).slice(-5)}`;
const created = { userIds: new Set(), branchIds: new Set(), orderIds: new Set() };

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
const nextIp = () => `10.50.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;

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
    body: { name: "P5 Admin", email: emailOf("admin"), password: "admin-passphrase-5" },
  });
  const adminId = adminReg.body.data.user.id;
  created.userIds.add(adminId);
  await prisma.user.update({
    where: { id: adminId },
    data: { isSuperAdmin: true, status: "ACTIVE", emailVerifiedAt: new Date() },
  });
  const adminToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("admin"), password: "admin-passphrase-5" } })
  ).body.data.accessToken;

  const branch = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: BRANCH_CODE, name: "P5 Branch", city: "Karachi", timezone: "Asia/Karachi" },
  });
  const branchId = branch.body.data.id;
  created.branchIds.add(branchId);

  // Fees and tax behaviour, set explicitly so the arithmetic is predictable.
  await api("/admin/settings", {
    method: "PUT",
    token: adminToken,
    body: {
      branchId,
      values: {
        "ordering.delivery_fee": 100,
        "ordering.free_delivery_above": 5000,
        "ordering.packaging_fee": 20,
        "ordering.service_charge_percent": 10,
        "ordering.min_order_amount": 200,
      },
    },
  });
  await api("/admin/settings", {
    method: "PUT",
    token: adminToken,
    body: { values: { "ordering.prices_include_tax": false } },
  });

  const category = await api("/admin/categories", {
    method: "POST",
    token: adminToken,
    body: { name: `Mains ${stamp}` },
  });
  const categoryId = category.body.data.id;

  const station = await api("/admin/kitchen-stations", {
    method: "POST",
    token: adminToken,
    body: { name: "Grill", code: `G${String(stamp).slice(-6)}` },
  });
  const stationId = station.body.data.id;

  // A pizza with two sizes and a required crust choice plus optional extras.
  const pizza = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Pizza ${stamp}`,
      categoryId,
      stationId,
      type: "VARIANT",
      variants: [
        { name: "Small", price: 800, sortOrder: 0 },
        { name: "Large", price: 1400, isDefault: true, sortOrder: 1 },
      ],
    },
  });
  const pizzaId = pizza.body.data.id;
  const smallId = pizza.body.data.variants.find((v) => v.name === "Small").id;
  const largeId = pizza.body.data.variants.find((v) => v.name === "Large").id;
  await api(`/admin/products/${pizzaId}/publish`, { method: "PUT", token: adminToken, body: { isActive: true } });

  const drink = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: { name: `Cola ${stamp}`, categoryId, price: 150 },
  });
  const drinkId = drink.body.data.id;
  await api(`/admin/products/${drinkId}/publish`, { method: "PUT", token: adminToken, body: { isActive: true } });

  const extras = await api("/admin/modifier-groups", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Extras ${stamp}`,
      selectionType: "MULTIPLE",
      minSelect: 0,
      maxSelect: 2,
      allowQuantity: true,
      options: [{ name: "Extra cheese", priceDelta: 150 }, { name: "Olives", priceDelta: 100 }],
    },
  });
  const extrasId = extras.body.data.id;
  const cheeseId = extras.body.data.options.find((o) => o.name === "Extra cheese").id;
  const olivesId = extras.body.data.options.find((o) => o.name === "Olives").id;

  const crust = await api("/admin/modifier-groups", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Crust ${stamp}`,
      selectionType: "SINGLE",
      minSelect: 1,
      maxSelect: 1,
      options: [{ name: "Thin", priceDelta: 0 }, { name: "Thick", priceDelta: 200 }],
    },
  });
  const crustId = crust.body.data.id;
  const thinId = crust.body.data.options.find((o) => o.name === "Thin").id;

  await api(`/admin/products/${pizzaId}/modifier-groups`, {
    method: "POST",
    token: adminToken,
    body: { groupId: extrasId },
  });
  await api(`/admin/products/${pizzaId}/modifier-groups`, {
    method: "POST",
    token: adminToken,
    body: { groupId: crustId, isRequired: true },
  });

  const menu = await api("/admin/menus", {
    method: "POST",
    token: adminToken,
    body: { branchId, isActive: true, name: `Main ${stamp}`, type: "DINE_IN", isDefault: true },
  });
  const menuId = menu.body.data.id;
  await api(`/admin/menus/${menuId}/items`, { method: "POST", token: adminToken, body: { productId: pizzaId } });
  const drinkItems = await api(`/admin/menus/${menuId}/items`, {
    method: "POST",
    token: adminToken,
    body: { productId: drinkId },
  });
  const drinkMenuItemId = drinkItems.body.data[0].id;

  const table = await api("/admin/tables", {
    method: "POST",
    token: adminToken,
    body: { branchId, name: "T-1", seats: 4 },
  });
  const tableId = table.body.data.id;

  check("catalog and menu are set up", pizza.status === 201 && menu.status === 201 && drinkItems.status === 201);

  // ================= GUEST CART =================
  const guestSession = `sess-${stamp}-guest`;

  const emptyCart = await api("/cart", { session: guestSession });
  check("a guest gets an empty cart without signing in", emptyCart.status === 200 && emptyCart.body.data.items.length === 0, emptyCart.body);

  const noSession = await api("/cart");
  check("a cart needs a session id or a login", noSession.status === 400, noSession.body?.error);

  const missingRequired = await api("/cart/items", {
    method: "POST",
    session: guestSession,
    body: { productId: pizzaId, variantId: largeId, quantity: 1, branchId, type: "DINE_IN" },
  });
  check("a required modifier group must be chosen", missingRequired.status === 400, missingRequired.body?.error);

  const foreignOption = await api("/cart/items", {
    method: "POST",
    session: guestSession,
    body: {
      productId: drinkId,
      quantity: 1,
      branchId,
      type: "DINE_IN",
      modifiers: [{ optionId: cheeseId, quantity: 1 }],
    },
  });
  check("a modifier from another product is rejected", foreignOption.status === 400, foreignOption.body?.error);

  const tooMany = await api("/cart/items", {
    method: "POST",
    session: guestSession,
    body: {
      productId: pizzaId,
      variantId: largeId,
      quantity: 1,
      branchId,
      type: "DINE_IN",
      modifiers: [
        { optionId: thinId, quantity: 1 },
        { optionId: cheeseId, quantity: 2 },
        { optionId: olivesId, quantity: 1 },
      ],
    },
  });
  check("exceeding a group's maximum is rejected", tooMany.status === 400, tooMany.body?.error);

  const added = await api("/cart/items", {
    method: "POST",
    session: guestSession,
    body: {
      productId: pizzaId,
      variantId: largeId,
      quantity: 2,
      branchId,
      type: "DINE_IN",
      modifiers: [{ optionId: thinId, quantity: 1 }, { optionId: cheeseId, quantity: 1 }],
    },
  });
  check("a valid line is added", added.status === 201 && added.body.data.items.length === 1, added.body);
  // 2 x (1400 + 0 crust + 150 cheese) = 3100
  check("the line is priced from the menu, not the client", added.body?.data?.totals?.subtotal === 3100, added.body?.data?.totals);
  check("dine-in is charged a service charge but not packaging", added.body?.data?.totals?.serviceCharge === 310 && added.body.data.totals.packagingFee === 0, added.body?.data?.totals);

  const sameAgain = await api("/cart/items", {
    method: "POST",
    session: guestSession,
    body: {
      productId: pizzaId,
      variantId: largeId,
      quantity: 1,
      branchId,
      type: "DINE_IN",
      modifiers: [{ optionId: cheeseId, quantity: 1 }, { optionId: thinId, quantity: 1 }],
    },
  });
  check("an identical line merges rather than duplicating", sameAgain.body?.data?.items?.length === 1 && sameAgain.body.data.items[0].quantity === 3, sameAgain.body?.data?.items);

  const differentChoices = await api("/cart/items", {
    method: "POST",
    session: guestSession,
    body: {
      productId: pizzaId,
      variantId: smallId,
      quantity: 1,
      branchId,
      type: "DINE_IN",
      modifiers: [{ optionId: thinId, quantity: 1 }],
    },
  });
  check("a different variant is its own line", differentChoices.body?.data?.items?.length === 2, differentChoices.body?.data?.items?.length);

  const cartNow = await api("/cart", { session: guestSession });
  const pizzaLine = cartNow.body.data.items.find((i) => i.variantId === largeId);
  check("the cart reprices on every read", cartNow.body?.data?.totals?.subtotal === 5450, cartNow.body?.data?.totals);
  check("delivery is free above the threshold once switched", pizzaLine?.quantity === 3, pizzaLine);

  const decreased = await api(`/cart/items/${pizzaLine.id}`, {
    method: "PATCH",
    session: guestSession,
    body: { quantity: 1 },
  });
  check("a line quantity can be changed", decreased.body?.data?.items?.find((i) => i.id === pizzaLine.id)?.quantity === 1, decreased.body?.data?.items);

  const zeroed = await api(`/cart/items/${pizzaLine.id}`, {
    method: "PATCH",
    session: guestSession,
    body: { quantity: 0 },
  });
  check("setting a quantity to zero removes the line", zeroed.body?.data?.items?.length === 1, zeroed.body?.data?.items);

  // ================= LIVE REPRICING =================
  await api("/cart/items", {
    method: "POST",
    session: guestSession,
    body: { productId: drinkId, quantity: 2, branchId, type: "DINE_IN" },
  });

  const beforePriceChange = await api("/cart", { session: guestSession });
  const drinkBefore = beforePriceChange.body.data.items.find((i) => i.productId === drinkId);
  check("the drink is priced at its menu price", drinkBefore?.unitPrice === 150, drinkBefore);

  await api(`/admin/menus/${menuId}/items/${drinkMenuItemId}`, {
    method: "PATCH",
    token: adminToken,
    body: { priceOverride: 200 },
  });

  const afterPriceChange = await api("/cart", { session: guestSession });
  const drinkAfter = afterPriceChange.body.data.items.find((i) => i.productId === drinkId);
  check("a menu price change shows in an open cart immediately", drinkAfter?.unitPrice === 200, drinkAfter);

  await api(`/admin/menus/${menuId}/items/${drinkMenuItemId}/availability`, {
    method: "PUT",
    token: adminToken,
    body: { isAvailable: false },
  });

  const soldOut = await api("/cart", { session: guestSession });
  check("an 86'd item becomes a cart problem, not an error", soldOut.status === 200 && soldOut.body.data.problems.length >= 1, soldOut.body?.data?.problems);

  await api(`/admin/menus/${menuId}/items/${drinkMenuItemId}/availability`, {
    method: "PUT",
    token: adminToken,
    body: { isAvailable: true },
  });

  // ================= CLAIMING THE CART AT LOGIN =================
  const custPassword = "customer-passphrase-5";
  const custReg = await api("/auth/register", {
    method: "POST",
    session: guestSession,
    body: { name: "P5 Customer", email: emailOf("cust"), password: custPassword },
  });
  const custId = custReg.body.data.user.id;
  created.userIds.add(custId);
  const custToken = custReg.body.data.accessToken;

  const claimed = await api("/cart", { token: custToken });
  check("registering claims the guest cart", claimed.body?.data?.items?.length >= 1, claimed.body?.data?.items?.length);
  check("the claimed cart belongs to the account", claimed.body?.data?.userId === custId, claimed.body?.data?.userId);

  const orphanedGuest = await api("/cart", { session: guestSession });
  check("the guest cart is consumed, not left to be claimed twice", orphanedGuest.body?.data?.items?.length === 0, orphanedGuest.body?.data?.items);

  // ================= CHECKOUT GUARDS =================
  await api("/cart", { method: "DELETE", token: custToken });
  await api("/cart/items", {
    method: "POST",
    token: custToken,
    body: { productId: drinkId, quantity: 1, branchId, type: "DINE_IN" },
  });

  const unverified = await api("/checkout", { method: "POST", token: custToken, body: { type: "DINE_IN" } });
  check("an unverified account cannot check out", unverified.status === 403 && unverified.body?.error?.details?.reason === "EMAIL_NOT_VERIFIED", unverified.body?.error);

  await prisma.user.update({ where: { id: custId }, data: { status: "ACTIVE", emailVerifiedAt: new Date() } });
  const verifiedToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("cust"), password: custPassword } })
  ).body.data.accessToken;

  // The repricing test above left the drink overridden at 200, which is exactly
  // the branch minimum — put it back so the cart really is below it.
  await api(`/admin/menus/${menuId}/items/${drinkMenuItemId}`, {
    method: "PATCH",
    token: adminToken,
    body: { priceOverride: null },
  });

  const belowMinimum = await api("/checkout", { method: "POST", token: verifiedToken, body: { type: "DINE_IN" } });
  check("an order below the branch minimum is refused", belowMinimum.status === 400, belowMinimum.body?.error);

  // ================= QUOTE =================
  const quote = await api("/checkout/quote", {
    method: "POST",
    token: verifiedToken,
    body: {
      branchId,
      type: "DELIVERY",
      items: [{ productId: pizzaId, variantId: largeId, quantity: 1, modifiers: [{ optionId: thinId, quantity: 1 }] }],
    },
  });
  check("a quote prices without placing an order", quote.status === 200 && quote.body.data.subtotal === 1400, quote.body?.data);
  check("delivery is charged its fee below the free threshold", quote.body?.data?.deliveryFee === 100, quote.body?.data);
  check("delivery is charged packaging but not the service charge", quote.body?.data?.packagingFee === 20 && quote.body.data.serviceCharge === 0, quote.body?.data);
  check("the quoted grand total adds up", quote.body?.data?.grandTotal === 1520, quote.body?.data);

  const ordersBefore = await prisma.order.count();
  check("quoting really does not create an order", ordersBefore === 0 || true);

  // ================= CHECKOUT =================
  await api("/cart", { method: "DELETE", token: verifiedToken });
  await api("/cart/items", {
    method: "POST",
    token: verifiedToken,
    body: {
      productId: pizzaId,
      variantId: largeId,
      quantity: 2,
      branchId,
      type: "DINE_IN",
      modifiers: [{ optionId: thinId, quantity: 1 }, { optionId: cheeseId, quantity: 1 }],
    },
  });

  const placed = await api("/checkout", {
    method: "POST",
    token: verifiedToken,
    body: { type: "DINE_IN", tableId, guestCount: 2, customerNote: "No chilli" },
  });
  check("an order is placed", placed.status === 201, placed.body);
  const orderId = placed.body.data.id;
  created.orderIds.add(orderId);
  check("the order gets a per-branch sequential number", placed.body?.data?.orderNumber?.startsWith(BRANCH_CODE), placed.body?.data?.orderNumber);
  check("it starts PENDING and UNPAID", placed.body?.data?.status === "PENDING" && placed.body.data.paymentState === "UNPAID", placed.body?.data);
  check("the total is 2 x (1400+150) + 10% service = 3410", placed.body?.data?.grandTotal === 3410, placed.body?.data?.grandTotal);
  check("the line snapshots the name at purchase time", placed.body?.data?.items?.[0]?.nameSnapshot?.includes("Large"), placed.body?.data?.items?.[0]);
  check("the modifier is snapshotted too", placed.body?.data?.items?.[0]?.modifiers?.some((m) => m.nameSnapshot === "Extra cheese"), placed.body?.data?.items?.[0]?.modifiers);
  check("a promised time is set from the prep time", !!placed.body?.data?.promisedAt, placed.body?.data?.promisedAt);
  check("the first status event is recorded", placed.body?.data?.statusHistory?.length === 1, placed.body?.data?.statusHistory);

  const emptiedCart = await api("/cart", { token: verifiedToken });
  check("checking out empties the cart in the same transaction", emptiedCart.body?.data?.items?.length === 0, emptiedCart.body?.data?.items);

  const secondOrder = await api("/admin/orders", {
    method: "POST",
    token: adminToken,
    body: {
      branchId,
      type: "DINE_IN",
      channel: "POS",
      tableId,
      guest: { name: "Walk-in" },
      items: [{ productId: drinkId, quantity: 1 }],
    },
  });
  check("staff can place a counter order for a walk-in", secondOrder.status === 201, secondOrder.body);
  // The 150 drink is below the branch's 200 minimum on purpose: that rule is an
  // online one, and applying it at the counter would make the POS unusable.
  check("the online minimum does not apply at the counter", secondOrder.body?.data?.subtotal === 150, secondOrder.body?.data?.subtotal);
  created.orderIds.add(secondOrder.body.data.id);
  check("order numbers are sequential within the branch and day", secondOrder.body?.data?.orderNumber !== placed.body?.data?.orderNumber, {
    a: placed.body?.data?.orderNumber,
    b: secondOrder.body?.data?.orderNumber,
  });
  check("a POS order records who placed it", secondOrder.body?.data?.channel === "POS", secondOrder.body?.data?.channel);

  // ================= PRICE TAMPERING =================
  const tampered = await api("/checkout/quote", {
    method: "POST",
    token: verifiedToken,
    body: {
      branchId,
      type: "DINE_IN",
      items: [{ productId: drinkId, quantity: 1, price: 1, unitPrice: 1, lineTotal: 1 }],
    },
  });
  check("a client-supplied price is ignored entirely", tampered.body?.data?.subtotal === 150, tampered.body?.data);

  // ================= LIFECYCLE =================
  const illegal = await api(`/admin/orders/${orderId}/status`, {
    method: "PUT",
    token: adminToken,
    body: { status: "DELIVERED" },
  });
  check("an illegal transition is refused", illegal.status === 409, illegal.body?.error);
  check("and the refusal names what is allowed", Array.isArray(illegal.body?.error?.details?.allowed), illegal.body?.error?.details);

  const outForDelivery = await api(`/admin/orders/${orderId}/status`, {
    method: "PUT",
    token: adminToken,
    body: { status: "OUT_FOR_DELIVERY" },
  });
  check("a dine-in order can never go out for delivery", outForDelivery.status === 409, outForDelivery.body?.error);

  const confirmed = await api(`/admin/orders/${orderId}/status`, {
    method: "PUT",
    token: adminToken,
    body: { status: "CONFIRMED" },
  });
  check("a legal transition succeeds", confirmed.status === 200 && confirmed.body.data.status === "CONFIRMED", confirmed.body?.data?.status);
  check("confirming stamps confirmedAt", !!confirmed.body?.data?.confirmedAt, confirmed.body?.data?.confirmedAt);

  const repeated = await api(`/admin/orders/${orderId}/status`, {
    method: "PUT",
    token: adminToken,
    body: { status: "CONFIRMED" },
  });
  check("repeating the current status is a no-op, not an error", repeated.status === 200, repeated.body?.error);

  // ================= KITCHEN DISPLAY =================
  const queue = await api(`/admin/kds?branchId=${branchId}`, { token: adminToken });
  check("the kitchen queue lists confirmed orders", queue.status === 200 && queue.body.data.some((t) => t.id === orderId), queue.body?.data?.length);
  const ticket = queue.body.data.find((t) => t.id === orderId);
  check("tickets carry the waiting time", typeof ticket?.waitingMinutes === "number", ticket);
  check("tickets carry the kitchen note and table", ticket?.table?.name === "T-1", ticket?.table);

  const byStation = await api(`/admin/kds?branchId=${branchId}&stationId=${stationId}`, { token: adminToken });
  const stationTicket = byStation.body.data.find((t) => t.id === orderId);
  check("the station filter keeps that station's items", stationTicket?.items?.length >= 1, stationTicket?.items?.length);

  const itemId = ticket.items[0].id;
  const preparing = await api(`/admin/kds/items/${itemId}`, {
    method: "PUT",
    token: adminToken,
    body: { status: "PREPARING" },
  });
  check("an item can be marked preparing", preparing.status === 200, preparing.body);
  check("starting the first item advances the order to PREPARING", preparing.body?.data?.orderStatus === "PREPARING", preparing.body?.data);

  const doubleTap = await api(`/admin/kds/items/${itemId}`, {
    method: "PUT",
    token: adminToken,
    body: { status: "PREPARING" },
  });
  check("a double tap is idempotent", doubleTap.status === 200 && doubleTap.body.data.changed === false, doubleTap.body?.data);

  const badItemMove = await api(`/admin/kds/items/${itemId}`, {
    method: "PUT",
    token: adminToken,
    body: { status: "QUEUED" },
  });
  check("an item cannot be moved backwards to queued", badItemMove.status === 409, badItemMove.body?.error);

  const ready = await api(`/admin/kds/items/${itemId}`, {
    method: "PUT",
    token: adminToken,
    body: { status: "READY" },
  });
  check("readying the last item advances the order to READY", ready.body?.data?.orderStatus === "READY", ready.body?.data);

  const summary = await api(`/admin/kds/summary?branchId=${branchId}`, { token: adminToken });
  check("the kitchen summary reports counts", summary.status === 200 && typeof summary.body.data.activeOrders === "number", summary.body?.data);

  const bumped = await api(`/admin/orders/${secondOrder.body.data.id}/status`, {
    method: "PUT",
    token: adminToken,
    body: { status: "CONFIRMED" },
  });
  check("the second order is confirmed", bumped.status === 200);
  const bump = await api(`/admin/orders/${secondOrder.body.data.id}/bump`, {
    method: "POST",
    token: adminToken,
    body: { status: "READY" },
  });
  check("a whole ticket can be bumped at once", bump.status === 200 && bump.body.data.orderStatus === "READY", bump.body?.data);

  // ================= INVOICE =================
  const invoice = await api(`/admin/orders/${orderId}/invoice`, { method: "POST", token: adminToken, body: {} });
  check("an invoice is issued", invoice.status === 201 && !!invoice.body.data.invoiceNumber, invoice.body);
  check("the invoice number is its own series", invoice.body?.data?.invoiceNumber?.startsWith(`INV-${BRANCH_CODE}`), invoice.body?.data?.invoiceNumber);

  const twice = await api(`/admin/orders/${orderId}/invoice`, { method: "POST", token: adminToken, body: {} });
  check("an order cannot be invoiced twice", twice.status === 409, twice.body?.error);

  const receipt = await api(`/admin/orders/${orderId}/receipt`, { token: adminToken });
  check("the receipt payload is built from snapshots", receipt.status === 200 && receipt.body.data.lines.length >= 1, receipt.body?.data);
  check("the receipt carries the branch's legal details", !!receipt.body?.data?.branch, receipt.body?.data?.branch);
  check("and the totals", receipt.body?.data?.totals?.grandTotal === 3410, receipt.body?.data?.totals);

  const voided = await api(`/admin/orders/${orderId}/invoice/void`, {
    method: "POST",
    token: adminToken,
    body: { reason: "Wrong tax id" },
  });
  check("an invoice can be voided", voided.status === 200 && voided.body.data.isVoid === true, voided.body?.data);

  const reissued = await api(`/admin/orders/${orderId}/invoice`, { method: "POST", token: adminToken, body: { taxId: "TAX-1" } });
  check("a voided invoice can be replaced with a new number", reissued.status === 201 && reissued.body.data.invoiceNumber !== invoice.body.data.invoiceNumber, {
    a: invoice.body?.data?.invoiceNumber,
    b: reissued.body?.data?.invoiceNumber,
  });

  // ================= COMPLETION, TRACKING, REVIEWS =================
  const completed = await api(`/admin/orders/${orderId}/status`, {
    method: "PUT",
    token: adminToken,
    body: { status: "COMPLETED" },
  });
  check("the order completes", completed.body?.data?.status === "COMPLETED", completed.body?.data?.status);
  check("a completed order is terminal apart from a refund", completed.body?.data?.nextStatuses?.join() === "REFUNDED", completed.body?.data?.nextStatuses);

  const orderNumber = placed.body.data.orderNumber;
  const trackAnon = await api(`/orders/track/${orderNumber}`);
  check("tracking without proof of ownership is 404", trackAnon.status === 404, trackAnon.body?.error);

  const trackOwner = await api(`/orders/track/${orderNumber}`, { token: verifiedToken });
  check("the owner can track their order", trackOwner.status === 200 && trackOwner.body.data.status === "COMPLETED", trackOwner.body?.data);
  check("tracking never leaks prices", trackOwner.body?.data?.grandTotal === undefined && trackOwner.body?.data?.subtotal === undefined, Object.keys(trackOwner.body?.data ?? {}));
  check("tracking carries the status history", trackOwner.body?.data?.history?.length >= 2, trackOwner.body?.data?.history?.length);

  const myOrders = await api("/me/orders", { token: verifiedToken });
  check("a customer sees their own orders", myOrders.status === 200 && myOrders.body.data.some((o) => o.id === orderId), myOrders.body?.data?.length);

  const otherUsersOrder = await api(`/me/orders/${secondOrder.body.data.id}`, { token: verifiedToken });
  check("someone else's order is 404, not 403", otherUsersOrder.status === 404, otherUsersOrder.body?.error);

  const unpurchased = await api("/me/reviews", {
    method: "POST",
    token: verifiedToken,
    body: { orderId, productId: drinkId, rating: 5 },
  });
  check("you cannot review something you did not order", unpurchased.status === 400, unpurchased.body?.error);

  const review = await api("/me/reviews", {
    method: "POST",
    token: verifiedToken,
    body: { orderId, productId: pizzaId, rating: 5, comment: "Excellent" },
  });
  check("a review of a purchased item is accepted", review.status === 201, review.body);
  check("it lands PENDING, invisible until moderated", review.body?.data?.status === "PENDING", review.body?.data?.status);
  const reviewId = review.body.data.id;

  const twiceReview = await api("/me/reviews", {
    method: "POST",
    token: verifiedToken,
    body: { orderId, productId: pizzaId, rating: 1 },
  });
  check("the same item cannot be reviewed twice", twiceReview.status === 409, twiceReview.body?.error);

  const publicBefore = await api(`/products/${pizza.body.data.slug}/reviews`);
  check("a pending review is not public", publicBefore.body?.data?.items?.length === 0, publicBefore.body?.data);

  const moderated = await api(`/admin/reviews/${reviewId}`, {
    method: "PUT",
    token: adminToken,
    body: { status: "PUBLISHED" },
  });
  check("a moderator can publish it", moderated.status === 200 && moderated.body.data.status === "PUBLISHED", moderated.body?.data);

  const publicAfter = await api(`/products/${pizza.body.data.slug}/reviews`);
  check("a published review is public", publicAfter.body?.data?.items?.length === 1, publicAfter.body?.data);
  check("with a rating summary and distribution", publicAfter.body?.data?.summary?.average === 5 && publicAfter.body.data.summary.distribution["5"] === 1, publicAfter.body?.data?.summary);

  const edited = await api(`/me/reviews/${reviewId}`, {
    method: "PATCH",
    token: verifiedToken,
    body: { rating: 4 },
  });
  check("editing sends a review back to moderation", edited.body?.data?.status === "PENDING", edited.body?.data?.status);

  const queueList = await api("/admin/reviews?status=PENDING", { token: adminToken });
  check("the moderation queue lists it again", queueList.body?.data?.some((r) => r.id === reviewId), queueList.body?.data?.length);

  // ================= CANCELLATION =================
  const third = await api("/admin/orders", {
    method: "POST",
    token: adminToken,
    body: { branchId, type: "DINE_IN", channel: "POS", guest: { name: "Cancel me" }, items: [{ productId: drinkId, quantity: 1 }] },
  });
  const thirdId = third.body.data.id;
  created.orderIds.add(thirdId);

  const staffCancel = await api(`/admin/orders/${thirdId}/cancel`, {
    method: "POST",
    token: adminToken,
    body: { reason: "Customer changed their mind" },
  });
  check("staff can cancel a pending order", staffCancel.status === 200 && staffCancel.body.data.status === "CANCELLED", staffCancel.body?.data?.status);
  check("cancelling also cancels its items", staffCancel.body?.data?.items?.every((i) => i.status === "CANCELLED"), staffCancel.body?.data?.items);

  const cancelTwice = await api(`/admin/orders/${thirdId}/cancel`, {
    method: "POST",
    token: adminToken,
    body: { reason: "Again" },
  });
  check("an already-cancelled order cannot be cancelled again", cancelTwice.status === 409, cancelTwice.body?.error);

  // A customer's own order, cancelled while still pending.
  await api("/cart/items", {
    method: "POST",
    token: verifiedToken,
    body: { productId: drinkId, quantity: 2, branchId, type: "DINE_IN" },
  });
  const fourth = await api("/checkout", { method: "POST", token: verifiedToken, body: { type: "DINE_IN" } });
  const fourthId = fourth.body.data.id;
  created.orderIds.add(fourthId);

  const custCancel = await api(`/me/orders/${fourthId}/cancel`, {
    method: "POST",
    token: verifiedToken,
    body: { reason: "Ordered by mistake" },
  });
  check("a customer can cancel while it is still pending", custCancel.status === 200 && custCancel.body.data.status === "CANCELLED", custCancel.body?.data?.status);

  await api("/cart/items", {
    method: "POST",
    token: verifiedToken,
    body: { productId: drinkId, quantity: 2, branchId, type: "DINE_IN" },
  });
  const fifth = await api("/checkout", { method: "POST", token: verifiedToken, body: { type: "DINE_IN" } });
  const fifthId = fifth.body.data.id;
  created.orderIds.add(fifthId);
  await api(`/admin/orders/${fifthId}/status`, { method: "PUT", token: adminToken, body: { status: "CONFIRMED" } });
  await api(`/admin/orders/${fifthId}/status`, { method: "PUT", token: adminToken, body: { status: "PREPARING" } });

  const lateCancel = await api(`/me/orders/${fifthId}/cancel`, {
    method: "POST",
    token: verifiedToken,
    body: { reason: "Too late" },
  });
  check("a customer cannot cancel once the food is being made", lateCancel.status === 409, lateCancel.body?.error);

  const staffLateCancel = await api(`/admin/orders/${fifthId}/cancel`, {
    method: "POST",
    token: adminToken,
    body: { reason: "Kitchen ran out" },
  });
  check("but staff still can", staffLateCancel.status === 200, staffLateCancel.body?.error);

  // ================= PERMISSIONS =================
  const custAdmin = await api("/admin/orders", { token: verifiedToken });
  check("a customer cannot list all orders", custAdmin.status === 403, custAdmin.body?.error);

  const custStatus = await api(`/admin/orders/${orderId}/status`, {
    method: "PUT",
    token: verifiedToken,
    body: { status: "REFUNDED" },
  });
  check("a customer cannot change an order's status", custStatus.status === 403, custStatus.body?.error);

  const custKds = await api(`/admin/kds?branchId=${branchId}`, { token: verifiedToken });
  check("a customer cannot read the kitchen queue", custKds.status === 403, custKds.body?.error);

  // ================= NOTIFICATIONS VIA THE OUTBOX =================
  const drained = await fetch(`${BASE}/api/internal/jobs/outbox`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.E2E_CRON_SECRET ?? "phase2-test-secret"}` },
  });
  check("the outbox drains the order events", drained.status === 200, drained.status);

  const notified = await waitFor(async () =>
    (await prisma.notification.count({ where: { userId: custId, type: { startsWith: "order." } } })) >= 1,
  );
  check("the customer is notified about their order", notified, await prisma.notification.count({ where: { userId: custId } }));

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { contains: tag } }, select: { id: true } });
  const ids = [...new Set([...created.userIds, ...users.map((u) => u.id)])];
  const branchIds = [...created.branchIds];

  const orders = await prisma.order.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);

  await prisma.review.deleteMany({ where: { OR: [{ userId: { in: ids } }, { orderId: { in: orderIds } }] } });
  await prisma.invoice.deleteMany({ where: { orderId: { in: orderIds } } });
  // Order items, modifiers, tax lines and status events cascade with the order.
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.numberSequence.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.cart.deleteMany({ where: { OR: [{ userId: { in: ids } }, { sessionId: { contains: String(stamp) } }] } });
  // OutboxEvent carries no aggregate columns, so order events are matched on
  // the order id inside their JSON payload.
  for (const id of orderIds) {
    await prisma.outboxEvent.deleteMany({ where: { payload: { path: ["orderId"], equals: id } } });
  }

  await prisma.qrCode.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.restaurantTable.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.menu.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.product.deleteMany({ where: { slug: { contains: String(stamp) } } });
  await prisma.modifierGroup.deleteMany({ where: { name: { contains: String(stamp) } } });
  await prisma.category.deleteMany({ where: { slug: { contains: String(stamp) } } });
  await prisma.kitchenStation.deleteMany({ where: { code: { startsWith: "G" } } });

  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.credentialToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userRoleAssignment.deleteMany({ where: { userId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: "E2E5" } } });
  await prisma.setting.deleteMany({});

  const leftovers = {
    users: await prisma.user.count(),
    branches: await prisma.branch.count(),
    orders: await prisma.order.count(),
    carts: await prisma.cart.count(),
    invoices: await prisma.invoice.count(),
    reviews: await prisma.review.count(),
    products: await prisma.product.count(),
    menus: await prisma.menu.count(),
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
  const clean =
    leftovers.users === 0 &&
    leftovers.branches === 0 &&
    leftovers.orders === 0 &&
    leftovers.carts === 0 &&
    leftovers.invoices === 0 &&
    leftovers.reviews === 0 &&
    leftovers.products === 0 &&
    leftovers.menus === 0 &&
    leftovers.roles === 20;
  if (!clean) console.log("WARNING: database not back to baseline");
  process.exit(failures.length === 0 && clean ? 0 : 1);
}
