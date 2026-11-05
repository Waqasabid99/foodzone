import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions } from "../src/lib/db-pool.js";
import { checkPages, cookiesFrom, openPhone } from "./lib/browser.mjs";

/**
 * Does the Insights section hold together on a phone?
 *
 * Charts are the hard case. A recharts container is width-driven, so it will
 * happily report a clean layout while drawing an axis nobody can read — and
 * a bar chart with eight long product names is the most likely thing in the
 * product to push a page sideways. Both are checked with real data behind
 * them rather than against empty states, because an empty chart fits
 * anywhere.
 */
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });

const stamp = Date.now();
const tag = `mob19-${stamp}`;
const short = String(stamp).slice(-5);
const emailOf = (name) => `${tag}-${name}@example.test`;
const made = { userIds: new Set(), branchIds: new Set(), productIds: new Set(), categoryIds: new Set(), expenseCategoryIds: new Set(), fiscalYearIds: new Set() };

let passed = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) {
    passed++;
    console.log("PASS ", name);
  } else {
    failures.push(name);
    console.log("FAIL ", name, detail === undefined ? "" : ` :: ${JSON.stringify(detail).slice(0, 240)}`);
  }
};

let ip = 0;
const nextIp = () => `10.91.${(++ip >> 8) & 255}.${ip & 255}`;

async function api(pathname, { method = "GET", body, token } = {}) {
  const res = await fetch(`${BASE}/api/v1${pathname}`, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": nextIp(), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function main() {
  const reg = await api("/auth/register", { method: "POST", body: { name: "mobileinsights", email: emailOf("admin"), password: "mobile-passphrase-19" } });
  const userId = reg.body?.data?.user?.id;
  if (!userId) throw new Error(`could not register: ${JSON.stringify(reg.body)}`);
  made.userIds.add(userId);
  await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date(), status: "ACTIVE", isSuperAdmin: true } });

  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
    body: JSON.stringify({ email: emailOf("admin"), password: "mobile-passphrase-19", client: "WEB" }),
  });
  const cookies = cookiesFrom(login);
  const token = (await login.json())?.data?.accessToken;

  const year = new Date().getUTCFullYear();
  const fiscal = await api("/admin/fiscal-years", { method: "POST", token, body: { name: `MOB19 FY ${year} ${short}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` } });
  if (fiscal.status === 201) made.fiscalYearIds.add(fiscal.body.data.id);

  const branch = await api("/admin/branches", { method: "POST", token, body: { code: `K${short}`, name: `Mob19 ${short}`, city: "Karachi", timezone: "Asia/Karachi" } });
  const branchId = branch.body.data.id;
  made.branchIds.add(branchId);

  const category = await api("/admin/categories", { method: "POST", token, body: { name: `Mob19 Mains ${short}` } });
  made.categoryIds.add(category.body.data.id);

  const menu = await api("/admin/menus", { method: "POST", token, body: { branchId, isActive: true, name: `Mob19 Menu ${short}`, type: "DINE_IN", isDefault: true } });

  // Ten dishes with deliberately long names: a bar chart's category axis is
  // where a phone layout breaks, and "Chicken" would never prove it.
  const variants = [];
  for (let i = 0; i < 10; i++) {
    const product = await api("/admin/products", {
      method: "POST",
      token,
      body: { name: `Slow-cooked Nihari with Bone Marrow and Naan ${i} ${short}`, categoryId: category.body.data.id, price: 500 + i * 123.45 },
    });
    const productId = product.body.data.id;
    made.productIds.add(productId);
    await api(`/admin/products/${productId}/publish`, { method: "PUT", token, body: { isActive: true } });
    await api(`/admin/menus/${menu.body.data.id}/items`, { method: "POST", token, body: { productId } });
    const variant = await prisma.productVariant.findFirst({ where: { productId }, select: { id: true } });
    variants.push({ productId, variantId: variant.id });
  }

  // Several completed orders so the trend has more than one point and the
  // mix chart has a tail to fold.
  for (let day = 0; day < 4; day++) {
    const order = await api("/admin/orders", {
      method: "POST",
      token,
      body: {
        branchId,
        type: "PICKUP",
        channel: "POS",
        guest: { name: "Walk in" },
        items: variants.slice(0, 6).map((row, index) => ({ productId: row.productId, variantId: row.variantId, quantity: index + 1 })),
      },
    });
    for (const status of ["CONFIRMED", "PREPARING", "READY", "COMPLETED"]) {
      await api(`/admin/orders/${order.body.data.id}/status`, { method: "PUT", token, body: { status } });
    }
  }

  const expenseCategory = await api("/admin/expense-categories", { method: "POST", token, body: { name: `Mob19 Utilities ${short}` } });
  if (expenseCategory.status === 201) made.expenseCategoryIds.add(expenseCategory.body.data.id);
  const expense = await api("/admin/expenses", {
    method: "POST",
    token,
    body: { branchId, categoryId: expenseCategory.body?.data?.id ?? null, payee: "Karachi Electric Supply Company Limited", amount: 23600, taxAmount: 3600 },
  });
  await api(`/admin/expenses/${expense.body.data.id}/submit`, { method: "POST", token });
  await api(`/admin/expenses/${expense.body.data.id}/approve`, { method: "POST", token });

  for (let i = 0; i < 4; i++) {
    await fetch(`${BASE}/api/internal/jobs/outbox`, { method: "POST", headers: { authorization: `Bearer ${process.env.E2E_CRON_SECRET ?? "phase2-test-secret"}` } });
  }

  const phone = await openPhone({ cookies });

  const screens = [
    "/dashboard/reports",
    "/dashboard/reports/sales",
    "/dashboard/reports/sales?groupBy=hour",
    "/dashboard/reports/sales?groupBy=month",
    "/dashboard/reports/product-mix",
    "/dashboard/reports/inventory",
    "/dashboard/reports/delivery",
    "/dashboard/reports/attendance",
    "/dashboard/audit-log",
    "/dashboard/audit-log?area=expense",
  ];

  await checkPages({ phone, base: BASE, screens, check });
  await phone.close();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));
}

async function cleanup() {
  const branchIds = [...made.branchIds];
  const orderIds = (await prisma.order.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((r) => r.id);
  const expenseIds = (await prisma.expense.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((r) => r.id);

  await prisma.journalLine.deleteMany({ where: { entry: { OR: [{ branchId: { in: branchIds } }, { expenseId: { in: expenseIds } }, { orderId: { in: orderIds } }] } } });
  await prisma.journalEntry.deleteMany({ where: { OR: [{ branchId: { in: branchIds } }, { expenseId: { in: expenseIds } }, { orderId: { in: orderIds } }] } });
  await prisma.expense.deleteMany({ where: { id: { in: expenseIds } } });
  await prisma.expenseCategory.deleteMany({ where: { id: { in: [...made.expenseCategoryIds] } } });
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderStatusEvent.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderDiscount.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderTaxLine.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderItemModifier.deleteMany({ where: { orderItem: { orderId: { in: orderIds } } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.invoice.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.stockMovement.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  // Entries first: a period holding a posting cannot be deleted, which is the
  // constraint that stops a stray cleanup orphaning somebody's books. Only
  // years this run created are touched.
  const ownPeriodIds = (
    await prisma.accountingPeriod.findMany({ where: { fiscalYearId: { in: [...made.fiscalYearIds] } }, select: { id: true } })
  ).map((row) => row.id);
  await prisma.journalLine.deleteMany({ where: { entry: { periodId: { in: ownPeriodIds } } } });
  await prisma.journalEntry.deleteMany({ where: { periodId: { in: ownPeriodIds } } });
  await prisma.accountingPeriod.deleteMany({ where: { id: { in: ownPeriodIds } } });
  await prisma.fiscalYear.deleteMany({ where: { id: { in: [...made.fiscalYearIds] } } });
  await prisma.menuItem.deleteMany({ where: { menu: { branchId: { in: branchIds } } } });
  await prisma.menuSection.deleteMany({ where: { menu: { branchId: { in: branchIds } } } });
  await prisma.menu.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.menuItem.deleteMany({ where: { productId: { in: [...made.productIds] } } });
  await prisma.productVariant.deleteMany({ where: { productId: { in: [...made.productIds] } } });
  await prisma.product.deleteMany({ where: { id: { in: [...made.productIds] } } });
  await prisma.category.deleteMany({ where: { id: { in: [...made.categoryIds] } } });
  await prisma.outboxEvent.deleteMany({});
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: [...made.userIds] } }, { branchId: { in: branchIds } }] } });
  await prisma.numberSequence.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: [...made.userIds] } } });
  await prisma.credentialToken.deleteMany({ where: { userId: { in: [...made.userIds] } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: [...made.userIds] } } });
  await prisma.userRoleAssignment.deleteMany({ where: { userId: { in: [...made.userIds] } } });
  await prisma.userDevice.deleteMany({ where: { userId: { in: [...made.userIds] } } });
  await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: [...made.userIds] } } } });
  await prisma.cart.deleteMany({ where: { userId: { in: [...made.userIds] } } });
  await prisma.user.deleteMany({ where: { id: { in: [...made.userIds] } } });
  await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });

  console.log("REMAINING", JSON.stringify({ users: await prisma.user.count(), branches: await prisma.branch.count(), orders: await prisma.order.count(), products: await prisma.product.count() }));
}

try {
  await main();
} catch (error) {
  console.error("MOBILE RUN CRASHED", error);
  failures.push("crashed");
} finally {
  await cleanup().catch((error) => console.error("CLEANUP FAILED", error));
  await prisma.$disconnect();
}

process.exit(failures.length ? 1 : 0);
