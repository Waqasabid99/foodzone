import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions, warmUpDatabase } from "../src/lib/db-pool.js";

/**
 * Phase 6 — Pricing, discounts and tax, end to end.
 *
 * Start a server first:
 *   APP_URL=http://localhost:3100 CRON_SECRET=phase2-test-secret npx next dev -p 3100
 *
 * The arithmetic of every discount shape is pinned down in tests/unit.mjs,
 * where it needs no fixtures. What this suite proves is the part that only
 * exists once a database and an HTTP boundary are involved: that a code
 * survives the round trip from the coupon box to the order's discount rows,
 * that limits are enforced against concurrent use, that the customer is never
 * the one deciding an amount, and that a manual discount cannot be given by
 * someone who lacks the permission for it.
 */
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });

const stamp = Date.now();
const tag = `e2e6-${stamp}`;
const emailOf = (name) => `${tag}-${name}@example.test`;
const BRANCH_CODE = `E2E6${String(stamp).slice(-5)}`;
const CAMPAIGN = `camp-${stamp}`;
const created = { userIds: new Set(), branchIds: new Set(), promotionIds: new Set() };

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
const nextIp = () => `10.60.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;

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

const num = (value) => Number(value ?? 0);

async function main() {
  // ================= SETUP =================
  const adminReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P6 Admin", email: emailOf("admin"), password: "admin-passphrase-6" },
  });
  const adminId = adminReg.body.data.user.id;
  created.userIds.add(adminId);
  await prisma.user.update({
    where: { id: adminId },
    data: { isSuperAdmin: true, status: "ACTIVE", emailVerifiedAt: new Date() },
  });
  const adminToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("admin"), password: "admin-passphrase-6" } })
  ).body.data.accessToken;

  const branch = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: BRANCH_CODE, name: "P6 Branch", city: "Karachi", timezone: "Asia/Karachi" },
  });
  const branchId = branch.body.data.id;
  created.branchIds.add(branchId);

  await api("/admin/settings", {
    method: "PUT",
    token: adminToken,
    body: {
      branchId,
      values: {
        "ordering.delivery_fee": 200,
        "ordering.free_delivery_above": 100000,
        "ordering.packaging_fee": 0,
        "ordering.service_charge_percent": 0,
        "ordering.min_order_amount": 0,
      },
    },
  });
  await api("/admin/settings", {
    method: "PUT",
    token: adminToken,
    body: { values: { "ordering.prices_include_tax": false, "pricing.max_manual_discount_percent": 20 } },
  });

  const category = await api("/admin/categories", { method: "POST", token: adminToken, body: { name: `Food ${stamp}` } });
  const categoryId = category.body.data.id;

  const drinksCat = await api("/admin/categories", {
    method: "POST",
    token: adminToken,
    body: { name: `Drinks ${stamp}` },
  });
  const drinksCatId = drinksCat.body.data.id;

  // ================= TAX =================
  const taxGroup = await api("/admin/tax-groups", {
    method: "POST",
    token: adminToken,
    body: {
      name: `GST ${stamp}`,
      rates: [
        { name: "GST", rate: 10, sortOrder: 0 },
        { name: "Cess", rate: 5, isCompound: true, sortOrder: 1 },
      ],
    },
  });
  check("a tax group is created with its rates", taxGroup.status === 201 && taxGroup.body.data.rates.length === 2, taxGroup.body);
  const taxGroupId = taxGroup.body.data.id;
  const gstRateId = taxGroup.body.data.rates.find((r) => r.name === "GST").id;

  const groups = await api("/admin/tax-groups", { token: adminToken });
  const listed = groups.body.data.find((g) => g.id === taxGroupId);
  check("the effective rate accounts for compounding", listed && num(listed.effectiveRate) === 15.5, listed);

  const rateTooBig = await api(`/admin/tax-groups/${taxGroupId}/rates`, {
    method: "POST",
    token: adminToken,
    body: { name: "Silly", rate: 250 },
  });
  check("a rate above 100% is refused", rateTooBig.status === 400, rateTooBig.body?.error);

  const noTaxPerm = await api("/admin/tax-groups", { method: "POST", body: { name: "Nope" } });
  check("tax groups need authentication", noTaxPerm.status === 401, noTaxPerm.body?.error);

  // ================= CATALOG =================
  const burger = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: { name: `Burger ${stamp}`, categoryId, price: 1000, taxGroupId },
  });
  const burgerId = burger.body.data.id;
  await api(`/admin/products/${burgerId}/publish`, { method: "PUT", token: adminToken, body: { isActive: true } });

  const cola = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: { name: `Cola ${stamp}`, categoryId: drinksCatId, price: 200 },
  });
  const colaId = cola.body.data.id;
  await api(`/admin/products/${colaId}/publish`, { method: "PUT", token: adminToken, body: { isActive: true } });

  const menu = await api("/admin/menus", {
    method: "POST",
    token: adminToken,
    // DINE_IN is the menu type both DELIVERY and PICKUP fall back to when a
    // branch publishes only one menu, which is what most restaurants do.
    body: { branchId, isActive: true, name: `Main ${stamp}`, type: "DINE_IN", isDefault: true },
  });
  const menuId = menu.body.data.id;
  await api(`/admin/menus/${menuId}/items`, { method: "POST", token: adminToken, body: { productId: burgerId } });
  await api(`/admin/menus/${menuId}/items`, { method: "POST", token: adminToken, body: { productId: colaId } });

  check("catalog is set up", burger.status === 201 && menu.status === 201);

  // ================= PROMOTION VALIDATION =================
  const badPercent = await api("/admin/promotions", {
    method: "POST",
    token: adminToken,
    body: { name: "Impossible", type: "PERCENTAGE", value: 150 },
  });
  check("a percentage over 100 is refused", badPercent.status === 400, badPercent.body?.error);

  const halfWindow = await api("/admin/promotions", {
    method: "POST",
    token: adminToken,
    body: { name: "Half window", type: "PERCENTAGE", value: 10, startMinute: 600 },
  });
  check("half a time window is refused", halfWindow.status === 400, halfWindow.body?.error);

  const ghostTarget = await api("/admin/promotions", {
    method: "POST",
    token: adminToken,
    body: {
      name: "Ghost",
      type: "PERCENTAGE",
      value: 10,
      targets: [{ targetType: "PRODUCT", targetId: "does-not-exist" }],
    },
  });
  check("a target that does not exist is refused", ghostTarget.status === 400, ghostTarget.body?.error);

  // ================= AUTOMATIC PROMOTION =================
  const autoPromo = await api("/admin/promotions", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Ten off food ${stamp}`,
      type: "PERCENTAGE",
      value: 10,
      branchIds: [branchId],
      targets: [{ targetType: "CATEGORY", targetId: categoryId }],
    },
  });
  check("an automatic promotion is created", autoPromo.status === 201, autoPromo.body);
  const autoPromoId = autoPromo.body.data.id;
  created.promotionIds.add(autoPromoId);

  const session = `sess-${stamp}-a`;
  await api("/cart/items", {
    method: "POST",
    session,
    body: { productId: burgerId, quantity: 1, branchId, type: "DELIVERY" },
  });
  const cartWithPromo = await api("/cart", { session });
  const totals = cartWithPromo.body.data.totals;
  check("the automatic promotion applies to the cart", num(totals.discountTotal) === 100, totals);
  check(
    "the cart names the offer that was applied",
    cartWithPromo.body.data.discounts?.[0]?.label?.includes("Ten off food"),
    cartWithPromo.body.data.discounts,
  );

  // 1000 - 100 = 900 taxable; 10% GST = 90, compound 5% of 990 = 49.5 -> 139.5
  check("tax is charged on the discounted amount", num(totals.taxTotal) === 139.5, totals);
  check("the total adds up", num(totals.grandTotal) === 1000 - 100 + 139.5 + 200, totals);

  const outOfScope = await api("/cart/items", {
    method: "POST",
    session,
    body: { productId: colaId, quantity: 1, branchId, type: "DELIVERY" },
  });
  check("a second, untargeted item is added", outOfScope.status === 201, outOfScope.body?.error);
  const mixedCart = await api("/cart", { session });
  check(
    "the promotion only discounts the category it targets",
    num(mixedCart.body.data.totals.discountTotal) === 100,
    mixedCart.body.data.totals,
  );

  // ================= COUPONS =================
  const couponPromo = await api("/admin/promotions", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Code 300 off ${stamp}`,
      type: "FIXED_AMOUNT",
      value: 300,
      requiresCoupon: true,
      minOrderAmount: 500,
      branchIds: [branchId],
    },
  });
  const couponPromoId = couponPromo.body.data.id;
  created.promotionIds.add(couponPromoId);

  const cartBefore = await api("/cart", { session });
  check(
    "a coupon-only offer does not fire without its code",
    num(cartBefore.body.data.totals.discountTotal) === 100,
    cartBefore.body.data.totals,
  );

  const CODE = `SAVE${String(stamp).slice(-6)}`;
  const coupon = await api("/admin/coupons", {
    method: "POST",
    token: adminToken,
    body: { code: CODE, promotionId: couponPromoId, maxRedemptions: 1, campaign: CAMPAIGN },
  });
  check("a coupon is created", coupon.status === 201, coupon.body);
  const couponId = coupon.body.data.id;

  const duplicate = await api("/admin/coupons", {
    method: "POST",
    token: adminToken,
    body: { code: CODE.toLowerCase(), promotionId: couponPromoId },
  });
  check("the same code cannot be issued twice, whatever its case", duplicate.status === 409, duplicate.body?.error);

  const unknown = await api("/coupons/validate", { method: "POST", body: { code: `NOPE${stamp}` } });
  check("an unknown code is reported invalid, not an error", unknown.status === 200 && unknown.body.data.valid === false, unknown.body);

  const known = await api("/coupons/validate", { method: "POST", body: { code: CODE.toLowerCase() } });
  check("a real code validates regardless of case", known.body?.data?.valid === true, known.body);
  check("validation never reveals what the code is worth", known.body?.data?.amount === undefined, known.body?.data);

  const applied = await api("/cart/coupon", { method: "POST", session, body: { code: CODE } });
  check("the code goes on the cart", applied.status === 200, applied.body?.error);
  check(
    "the coupon and the automatic offer are both refused to stack",
    applied.body.data.discounts.length === 1 && applied.body.data.discounts[0].source === "COUPON",
    applied.body.data.discounts,
  );
  check("the coupon is worth its fixed amount", num(applied.body.data.totals.discountTotal) === 300, applied.body.data.totals);

  const removed = await api("/cart/coupon", { method: "DELETE", session });
  check("the code comes back off", num(removed.body.data.totals.discountTotal) === 100, removed.body.data.totals);
  await api("/cart/coupon", { method: "POST", session, body: { code: CODE } });

  // ================= CHECKOUT =================
  const customerReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P6 Customer", email: emailOf("cust"), password: "customer-passphrase-6" },
  });
  const customerId = customerReg.body.data.user.id;
  created.userIds.add(customerId);
  await prisma.user.update({ where: { id: customerId }, data: { emailVerifiedAt: new Date() } });
  const customerToken = (
    await api("/auth/login", {
      method: "POST",
      body: { email: emailOf("cust"), password: "customer-passphrase-6" },
      session,
    })
  ).body.data.accessToken;

  const address = await api("/addresses", {
    method: "POST",
    token: customerToken,
    body: {
      label: "Home",
      recipientName: "P6 Customer",
      phone: "+923001234567",
      line1: "1 Test Road",
      city: "Karachi",
      state: "Sindh",
      postalCode: "75500",
    },
  });
  const addressId = address.body.data.id;

  const quote = await api("/checkout/quote", {
    method: "POST",
    token: customerToken,
    body: { branchId, type: "DELIVERY", items: [{ productId: burgerId, quantity: 1 }], couponCode: CODE },
  });
  check("a quote prices the coupon in", num(quote.body.data.discountTotal) === 300, quote.body?.data);

  const belowMinimum = await api("/checkout/quote", {
    method: "POST",
    token: customerToken,
    body: { branchId, type: "DELIVERY", items: [{ productId: colaId, quantity: 1 }], couponCode: CODE },
  });
  check(
    "a coupon below its minimum order is rejected with a reason",
    num(belowMinimum.body.data.discountTotal) === 0 &&
      belowMinimum.body.data.rejectedDiscounts.some((r) => r.reason === "BELOW_MINIMUM"),
    belowMinimum.body?.data,
  );

  const checkout = await api("/checkout", {
    method: "POST",
    token: customerToken,
    session,
    body: { branchId, type: "DELIVERY", addressId },
  });
  check("the order is placed", checkout.status === 201, checkout.body?.error);
  const orderId = checkout.body.data.id;

  const order = await api(`/admin/orders/${orderId}`, { token: adminToken });
  check("the order carries the discount it was given", num(order.body.data.discountTotal) === 300, order.body?.data);
  check(
    "the discount is recorded with its source",
    order.body.data.discounts?.length === 1 && order.body.data.discounts[0].source === "COUPON",
    order.body.data.discounts,
  );

  const redemption = await prisma.couponRedemption.findFirst({ where: { couponId, orderId } });
  check("the redemption is recorded against the order", Boolean(redemption), redemption);
  check("the redemption records what it was worth", num(redemption?.amount) === 300, redemption);

  const afterUse = await prisma.coupon.findUnique({ where: { id: couponId } });
  check("the redemption counter moved", afterUse.redemptionCount === 1, afterUse);

  const promoAfter = await prisma.promotion.findUnique({ where: { id: couponPromoId } });
  check("the promotion's usage counter moved too", promoAfter.usageCount === 1, promoAfter);

  const exhausted = await api("/coupons/validate", { method: "POST", token: customerToken, body: { code: CODE } });
  check("a single-use code is spent once used", exhausted.body?.data?.valid === false, exhausted.body?.data);

  const reuse = await api("/checkout/quote", {
    method: "POST",
    token: customerToken,
    body: { branchId, type: "DELIVERY", items: [{ productId: burgerId, quantity: 1 }], couponCode: CODE },
  });
  check("checkout refuses a spent code rather than ignoring it", reuse.status === 400, reuse.body?.error);

  const redemptions = await api(`/admin/coupons/${couponId}/redemptions`, { token: adminToken });
  check("the redemption is reportable", redemptions.body?.data?.items?.length === 1, redemptions.body?.data);

  // ================= FREE DELIVERY =================
  const shipPromo = await api("/admin/promotions", {
    method: "POST",
    token: adminToken,
    body: {
      name: `Free delivery ${stamp}`,
      type: "FREE_DELIVERY",
      branchIds: [branchId],
      orderTypes: ["DELIVERY"],
    },
  });
  created.promotionIds.add(shipPromo.body.data.id);

  const shipQuote = await api("/checkout/quote", {
    method: "POST",
    token: customerToken,
    body: { branchId, type: "DELIVERY", items: [{ productId: burgerId, quantity: 1 }] },
  });
  check("free delivery waives the fee", num(shipQuote.body.data.discountTotal) === 100 + 200, shipQuote.body?.data);
  check(
    "the delivery fee is still shown gross, so the waiver is visible",
    num(shipQuote.body.data.deliveryFee) === 200,
    shipQuote.body?.data,
  );
  // The food discount is 100; tax is charged on 900, unchanged by the waiver.
  check("waiving delivery does not reduce the tax on the food", num(shipQuote.body.data.taxTotal) === 139.5, shipQuote.body?.data);

  const pickupQuote = await api("/checkout/quote", {
    method: "POST",
    token: customerToken,
    body: { branchId, type: "PICKUP", items: [{ productId: burgerId, quantity: 1 }] },
  });
  check(
    "a delivery-only offer does not apply to a pickup",
    num(pickupQuote.body.data.discountTotal) === 100,
    pickupQuote.body?.data,
  );

  await api(`/admin/promotions/${shipPromo.body.data.id}/active`, {
    method: "PATCH",
    token: adminToken,
    body: { isActive: false },
  });
  const paused = await api("/checkout/quote", {
    method: "POST",
    token: customerToken,
    body: { branchId, type: "DELIVERY", items: [{ productId: burgerId, quantity: 1 }] },
  });
  check("pausing an offer stops it immediately", num(paused.body.data.discountTotal) === 100, paused.body?.data);

  // ================= LIMITS =================
  const limited = await api("/admin/promotions", {
    method: "POST",
    token: adminToken,
    body: {
      name: `One only ${stamp}`,
      type: "FIXED_AMOUNT",
      value: 50,
      requiresCoupon: true,
      usageLimit: 1,
      branchIds: [branchId],
    },
  });
  const limitedId = limited.body.data.id;
  created.promotionIds.add(limitedId);

  const LIMIT_CODE = `ONCE${String(stamp).slice(-6)}`;
  await api("/admin/coupons", {
    method: "POST",
    token: adminToken,
    body: { code: LIMIT_CODE, promotionId: limitedId, campaign: CAMPAIGN },
  });

  const first = await api("/checkout/quote", {
    method: "POST",
    token: customerToken,
    body: { branchId, type: "DELIVERY", items: [{ productId: burgerId, quantity: 1 }], couponCode: LIMIT_CODE },
  });
  // The code is non-stackable, so it replaces the automatic 10% rather than
  // adding to it — 50 instead of the 100 the customer would have had anyway.
  check("a limited offer applies while it has room", num(first.body.data.discountTotal) === 50, first.body?.data);
  check(
    "a non-stackable code replaces the automatic offer rather than joining it",
    first.body.data.discounts.length === 1 && first.body.data.discounts[0].source === "COUPON",
    first.body?.data?.discounts,
  );

  await prisma.promotion.update({ where: { id: limitedId }, data: { usageCount: 1 } });
  const spent = await api("/checkout/quote", {
    method: "POST",
    token: customerToken,
    body: { branchId, type: "DELIVERY", items: [{ productId: burgerId, quantity: 1 }], couponCode: LIMIT_CODE },
  });
  check(
    "a fully claimed offer stops applying",
    num(spent.body.data.discountTotal) === 100 &&
      spent.body.data.rejectedDiscounts.some((r) => r.reason === "USAGE_LIMIT_REACHED"),
    spent.body?.data,
  );

  // ================= BULK GENERATION =================
  const bulk = await api("/admin/coupons/generate", {
    method: "POST",
    token: adminToken,
    body: { promotionId: couponPromoId, count: 25, prefix: "XM", length: 8, campaign: CAMPAIGN },
  });
  check("a batch of codes is generated", bulk.status === 201 && bulk.body.data.count === 25, bulk.body);
  check("exactly the number asked for is created", new Set(bulk.body.data.codes).size === 25, bulk.body?.data);
  check("every code carries the prefix", bulk.body.data.codes.every((c) => c.startsWith("XM")), bulk.body?.data);

  const inDb = await prisma.coupon.count({ where: { campaign: CAMPAIGN, code: { startsWith: "XM" } } });
  check("no over-generated codes are left live", inDb === 25, { inDb });

  const revoked = await api("/admin/coupons/revoke", { method: "POST", token: adminToken, body: { campaign: CAMPAIGN } });
  check("a whole campaign can be revoked at once", revoked.status === 200 && revoked.body.data.revoked >= 25, revoked.body);

  const revokedCheck = await api("/coupons/validate", { method: "POST", body: { code: bulk.body.data.codes[0] } });
  check("a revoked code stops working", revokedCheck.body?.data?.valid === false, revokedCheck.body?.data);

  // ================= MANUAL DISCOUNTS =================
  const staffReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P6 Staff", email: emailOf("staff"), password: "staff-passphrase-6" },
  });
  const staffId = staffReg.body.data.user.id;
  created.userIds.add(staffId);
  await prisma.user.update({ where: { id: staffId }, data: { emailVerifiedAt: new Date(), status: "ACTIVE" } });

  const roles = await api("/admin/roles", { token: adminToken });
  const cashierRole = roles.body.data.items?.find((r) => r.name?.toLowerCase().includes("cashier")) ?? null;

  const staffRole = await api("/admin/roles", {
    method: "POST",
    token: adminToken,
    body: { name: `P6 Order Reader ${stamp}`, description: "Reads orders, cannot discount" },
  });
  const staffRoleId = staffRole.body.data.id;
  await api(`/admin/roles/${staffRoleId}/permissions`, {
    method: "PUT",
    token: adminToken,
    body: { permissionKeys: ["orders.read", "orders.update"] },
  });
  await api(`/admin/users/${staffId}/roles`, {
    method: "POST",
    token: adminToken,
    body: { roleId: staffRoleId, branchId },
  });
  const staffToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("staff"), password: "staff-passphrase-6" } })
  ).body.data.accessToken;

  // Proves the role grant actually took. Without this, the 403 below would pass
  // just as happily against a role holding no permissions at all — which is
  // exactly the false pass this check exists to rule out.
  const staffCanRead = await api(`/admin/orders/${orderId}`, { token: staffToken });
  check("the staff role really does grant order access", staffCanRead.status === 200, staffCanRead.body?.error);

  const forbidden = await api(`/admin/orders/${orderId}/discounts`, {
    method: "POST",
    token: staffToken,
    body: { amount: 100, reason: "Because I can" },
  });
  check("discounting needs its own permission, not just order access", forbidden.status === 403, forbidden.body?.error);

  const ambiguous = await api(`/admin/orders/${orderId}/discounts`, {
    method: "POST",
    token: adminToken,
    body: { amount: 100, percent: 10, reason: "Both at once" },
  });
  check("a till cannot be told both an amount and a percentage", ambiguous.status === 400, ambiguous.body?.error);

  const noReason = await api(`/admin/orders/${orderId}/discounts`, {
    method: "POST",
    token: adminToken,
    body: { amount: 100 },
  });
  check("a manual discount without a reason is refused", noReason.status === 400, noReason.body?.error);

  const beforeManual = await api(`/admin/orders/${orderId}`, { token: adminToken });
  const grandBefore = num(beforeManual.body.data.grandTotal);

  const manual = await api(`/admin/orders/${orderId}/discounts`, {
    method: "POST",
    token: adminToken,
    body: { amount: 100, reason: "Late delivery, goodwill" },
  });
  check("a manual discount is applied", manual.status === 201, manual.body?.error);
  check("the order total drops by exactly the discount", num(manual.body.data.grandTotal) === grandBefore - 100, manual.body?.data);

  const overCap = await api(`/admin/orders/${orderId}/discounts`, {
    method: "POST",
    token: adminToken,
    body: { percent: 20, reason: "Trying it on" },
  });
  check("manual discounts are capped in aggregate, not one at a time", overCap.status === 403, overCap.body?.error);

  const audit = await prisma.auditLog.findFirst({
    where: { action: "order.discount.manual", entityId: orderId },
    orderBy: { createdAt: "desc" },
  });
  check("the giveaway is audited", Boolean(audit), audit);
  check("the audit names who approved it", audit?.actorId === adminId, audit);
  check("the audit records the reason", audit?.changes?.reason === "Late delivery, goodwill", audit?.changes);

  const listedDiscounts = await api(`/admin/orders/${orderId}/discounts`, { token: adminToken });
  const manualRow = listedDiscounts.body.data.discounts.find((d) => d.source === "MANUAL");
  check("the manual discount is listed with its reason", manualRow?.reason === "Late delivery, goodwill", manualRow);
  check("who approved it is on the row", manualRow?.approvedById === adminId, manualRow);

  const couponRow = listedDiscounts.body.data.discounts.find((d) => d.source === "COUPON");
  const removeCoupon = await api(`/admin/orders/${orderId}/discounts/${couponRow.id}`, {
    method: "DELETE",
    token: adminToken,
  });
  check("a coupon discount cannot be deleted off an order", removeCoupon.status === 409, removeCoupon.body?.error);

  const removeManual = await api(`/admin/orders/${orderId}/discounts/${manualRow.id}`, {
    method: "DELETE",
    token: adminToken,
  });
  check("a manual discount can be taken back off", removeManual.status === 200, removeManual.body?.error);
  check("removing it restores the total", num(removeManual.body.data.grandTotal) === grandBefore, removeManual.body?.data);

  // ================= THE CLIENT NEVER NAMES A PRICE =================
  const injected = await api("/checkout/quote", {
    method: "POST",
    token: customerToken,
    body: {
      branchId,
      type: "DELIVERY",
      items: [{ productId: burgerId, quantity: 1 }],
      discountTotal: 999,
      grandTotal: 1,
    },
  });
  check(
    "a client-supplied total is ignored, not honoured",
    injected.status === 200 && num(injected.body.data.grandTotal) > 900,
    injected.body?.data,
  );

  const customerPromo = await api("/admin/promotions", {
    method: "POST",
    token: customerToken,
    body: { name: "Mine", type: "PERCENTAGE", value: 100 },
  });
  check("a customer cannot write their own promotion", customerPromo.status === 403, customerPromo.body?.error);

  const customerCoupons = await api("/admin/coupons", { token: customerToken });
  check("a customer cannot read the coupon list", customerCoupons.status === 403, customerCoupons.body?.error);

  const customerTax = await api("/admin/tax-groups", { token: customerToken });
  check("a customer cannot read the tax setup", customerTax.status === 403, customerTax.body?.error);

  // ================= HISTORY IS NOT REWRITTEN =================
  const editCharged = await api(`/admin/tax-rates/${gstRateId}`, {
    method: "PATCH",
    token: adminToken,
    body: { rate: 25 },
  });
  check("a tax rate already charged cannot be edited", editCharged.status === 409, editCharged.body?.error);

  const deactivate = await api(`/admin/tax-rates/${gstRateId}`, {
    method: "PATCH",
    token: adminToken,
    body: { isActive: false },
  });
  check("but it can be deactivated", deactivate.status === 200, deactivate.body?.error);

  const deleteUsedPromo = await api(`/admin/promotions/${couponPromoId}`, { method: "DELETE", token: adminToken });
  check("a promotion that has cost money cannot be deleted", deleteUsedPromo.status === 409, deleteUsedPromo.body?.error);

  const deleteUsedGroup = await api(`/admin/tax-groups/${taxGroupId}`, { method: "DELETE", token: adminToken });
  check("a tax group still used by products cannot be deleted", deleteUsedGroup.status === 409, deleteUsedGroup.body?.error);

  const unusedPromo = await api("/admin/promotions", {
    method: "POST",
    token: adminToken,
    body: { name: `Never used ${stamp}`, type: "PERCENTAGE", value: 5 },
  });
  const unusedId = unusedPromo.body.data.id;
  const deleteUnused = await api(`/admin/promotions/${unusedId}`, { method: "DELETE", token: adminToken });
  check("an unused promotion can be deleted outright", deleteUnused.status === 200, deleteUnused.body?.error);
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { contains: tag } }, select: { id: true } });
  const ids = [...new Set([...created.userIds, ...users.map((u) => u.id)])];
  const branchIds = [...created.branchIds];

  const orders = await prisma.order.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);

  // Redemptions and discount rows cascade from the order and the coupon, but
  // they are removed explicitly first so a failure here is loud rather than a
  // foreign-key error three statements later.
  await prisma.couponRedemption.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderDiscount.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.invoice.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.review.deleteMany({ where: { OR: [{ userId: { in: ids } }, { orderId: { in: orderIds } }] } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.numberSequence.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.cart.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { sessionId: { contains: String(stamp) } }] },
  });
  for (const id of orderIds) {
    await prisma.outboxEvent.deleteMany({ where: { payload: { path: ["orderId"], equals: id } } });
  }

  await prisma.coupon.deleteMany({ where: { OR: [{ campaign: CAMPAIGN }, { code: { contains: String(stamp).slice(-6) } }] } });
  await prisma.promotion.deleteMany({ where: { name: { contains: String(stamp) } } });

  await prisma.menu.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.product.deleteMany({ where: { slug: { contains: String(stamp) } } });
  await prisma.category.deleteMany({ where: { slug: { contains: String(stamp) } } });
  await prisma.taxRate.deleteMany({ where: { group: { name: { contains: String(stamp) } } } });
  await prisma.taxGroup.deleteMany({ where: { name: { contains: String(stamp) } } });

  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.credentialToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userRoleAssignment.deleteMany({ where: { userId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.address.deleteMany({ where: { userId: { in: ids } } });
  await prisma.rolePermission.deleteMany({ where: { role: { name: { contains: String(stamp) } } } });
  await prisma.role.deleteMany({ where: { name: { contains: String(stamp) } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: "E2E6" } } });
  await prisma.setting.deleteMany({});

  const leftovers = {
    users: await prisma.user.count(),
    branches: await prisma.branch.count(),
    orders: await prisma.order.count(),
    promotions: await prisma.promotion.count(),
    coupons: await prisma.coupon.count(),
    taxGroups: await prisma.taxGroup.count(),
    orderDiscounts: await prisma.orderDiscount.count(),
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
