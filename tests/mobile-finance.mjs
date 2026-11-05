import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions } from "../src/lib/db-pool.js";
import { checkPages, cookiesFrom, openPhone } from "./lib/browser.mjs";

/**
 * Does the Finance section hold together on a phone?
 *
 * Driven straight over the DevTools protocol rather than through a test
 * framework, because the only questions are whether anything scrolls sideways
 * at 390px and whether the page threw on the way in. Both are things a
 * screenshot would not tell you and a human scrolling on a desk monitor would
 * never notice.
 *
 * A statement is the hardest case in the whole product to fit on a phone: it
 * is four columns of figures that mean nothing apart from each other, so the
 * temptation is to let it overflow and call it a table. It is checked here
 * with real postings behind it, not an empty state.
 */
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });
const stamp = Date.now();
const tag = `mob18-${stamp}`;
const short = String(stamp).slice(-5);
const emailOf = (name) => `${tag}-${name}@example.test`;
const made = { userIds: new Set(), branchIds: new Set(), productIds: new Set(), categoryIds: new Set(), fiscalYearIds: new Set(), expenseCategoryIds: new Set() };

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
const nextIp = () => `10.88.${(++ip >> 8) & 255}.${ip & 255}`;

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
  // ================= enough data that nothing is an empty state ============
  const reg = await api("/auth/register", { method: "POST", body: { name: "mobileadmin", email: emailOf("admin"), password: "mobile-passphrase-18" } });
  const userId = reg.body?.data?.user?.id;
  if (!userId) throw new Error(`could not register: ${JSON.stringify(reg.body)}`);
  made.userIds.add(userId);
  await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date(), status: "ACTIVE", isSuperAdmin: true } });

  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
    body: JSON.stringify({ email: emailOf("admin"), password: "mobile-passphrase-18", client: "WEB" }),
  });
  const cookies = cookiesFrom(login);
  const token = (await login.json())?.data?.accessToken;

  const year = new Date().getUTCFullYear();
  const fiscal = await api("/admin/fiscal-years", {
    method: "POST",
    token,
    body: { name: `MOB FY ${year} ${short}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` },
  });
  if (fiscal.status === 201) made.fiscalYearIds.add(fiscal.body.data.id);

  const branch = await api("/admin/branches", { method: "POST", token, body: { code: `M${short}`, name: `Mob ${short}`, city: "Karachi", timezone: "Asia/Karachi" } });
  const branchId = branch.body.data.id;
  made.branchIds.add(branchId);

  const category = await api("/admin/categories", { method: "POST", token, body: { name: `Mob Mains ${short}` } });
  made.categoryIds.add(category.body.data.id);
  const product = await api("/admin/products", { method: "POST", token, body: { name: `Mob Nihari ${short}`, categoryId: category.body.data.id, price: 1899.99 } });
  const productId = product.body.data.id;
  made.productIds.add(productId);
  await api(`/admin/products/${productId}/publish`, { method: "PUT", token, body: { isActive: true } });
  const variant = await prisma.productVariant.findFirst({ where: { productId }, select: { id: true } });

  const menu = await api("/admin/menus", { method: "POST", token, body: { branchId, isActive: true, name: `Mob Menu ${short}`, type: "DINE_IN", isDefault: true } });
  await api(`/admin/menus/${menu.body.data.id}/items`, { method: "POST", token, body: { productId } });

  const session = await api("/admin/registers", { method: "POST", token, body: { branchId, registerName: `till-${short}`, openingFloat: 5000 } });
  const sessionId = session.body.data.id;

  const order = await api("/admin/orders", {
    method: "POST",
    token,
    body: { branchId, type: "PICKUP", channel: "POS", guest: { name: "A customer with a fairly long walk-in name" }, items: [{ productId, variantId: variant.id, quantity: 3 }] },
  });
  const orderId = order.body.data.id;
  const payment = await api("/admin/payments", { method: "POST", token, body: { orderId, method: "CASH", registerSessionId: sessionId } });
  const paymentId = payment.body.data.payment?.id ?? payment.body.data.id;
  await api(`/admin/payments/${paymentId}/collect`, { method: "POST", token, body: { registerSessionId: sessionId } });
  await api(`/admin/registers/${sessionId}/movements`, { method: "POST", token, body: { type: "PAY_OUT", amount: 300, reason: "Cleaner" } });

  const refund = await api("/admin/refunds", { method: "POST", token, body: { paymentId, amount: 250, reason: "A dish was sent back to the kitchen" } });
  const refundId = refund.body?.data?.id;

  const expenseCategory = await api("/admin/expense-categories", { method: "POST", token, body: { name: `Mob Utilities ${short}` } });
  if (expenseCategory.status === 201) made.expenseCategoryIds.add(expenseCategory.body.data.id);
  const expense = await api("/admin/expenses", {
    method: "POST",
    token,
    body: { branchId, categoryId: expenseCategory.body?.data?.id ?? null, payee: "Karachi Electric Supply Company", amount: 11800, taxAmount: 1800, description: "Monthly bill" },
  });
  const expenseId = expense.body.data.id;
  await api(`/admin/expenses/${expenseId}/submit`, { method: "POST", token });
  await api(`/admin/expenses/${expenseId}/approve`, { method: "POST", token });

  for (const status of ["CONFIRMED", "PREPARING", "READY", "COMPLETED"]) {
    await api(`/admin/orders/${orderId}/status`, { method: "PUT", token, body: { status } });
  }
  for (let i = 0; i < 4; i++) {
    await fetch(`${BASE}/api/internal/jobs/outbox`, { method: "POST", headers: { authorization: `Bearer ${process.env.E2E_CRON_SECRET ?? "phase2-test-secret"}` } });
  }
  await api(`/admin/orders/${orderId}/invoice`, { method: "POST", token, body: { billing: { name: "Acme Catering Services Limited", taxId: "NTN-1234567" } } });

  const cash = await prisma.account.findFirst({ where: { code: "1100" }, select: { id: true } });
  const other = await prisma.account.findFirst({ where: { code: "5990" }, select: { id: true } });
  const entry = await api("/admin/journal-entries", {
    method: "POST",
    token,
    body: {
      branchId,
      memo: `Mobile correction ${short} — a memo long enough to need wrapping on a narrow screen`,
      lines: [{ accountId: other.id, debit: 1250.75 }, { accountId: cash.id, credit: 1250.75 }],
      post: true,
    },
  });
  const entryId = entry.body?.data?.id;

  await api(`/admin/registers/${sessionId}/close`, { method: "POST", token, body: { countedCash: 100, notes: "Counted twice" } });

  // ================= the browser =================
  const phone = await openPhone({ cookies });

  const screens = [
    "/dashboard/payments",
    `/dashboard/payments/${paymentId}`,
    "/dashboard/refunds",
    `/dashboard/refunds/${refundId}`,
    "/dashboard/invoices",
    "/dashboard/registers",
    `/dashboard/registers/${sessionId}`,
    "/dashboard/expenses",
    "/dashboard/expenses/new",
    `/dashboard/expenses/${expenseId}`,
    "/dashboard/accounts",
    "/dashboard/accounts/new",
    `/dashboard/accounts/${other.id}`,
    "/dashboard/journal",
    "/dashboard/journal/new",
    `/dashboard/journal/${entryId}`,
    "/dashboard/periods",
    "/dashboard/taxes",
    "/dashboard/financial-reports",
    "/dashboard/financial-reports/profit-and-loss",
    "/dashboard/financial-reports/balance-sheet",
    "/dashboard/financial-reports/trial-balance",
    "/dashboard/financial-reports/cash-flow",
  ];

  await checkPages({ phone, base: BASE, screens, check });

  await phone.close();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));
}

async function cleanup() {
  const branchIds = [...made.branchIds];
  const orderIds = (await prisma.order.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((r) => r.id);
  const sessionIds = (await prisma.cashRegisterSession.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((r) => r.id);
  const expenseIds = (await prisma.expense.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((r) => r.id);

  await prisma.journalLine.deleteMany({ where: { entry: { OR: [{ branchId: { in: branchIds } }, { expenseId: { in: expenseIds } }, { orderId: { in: orderIds } }] } } });
  await prisma.journalEntry.updateMany({ where: { reversalOfId: { not: null }, branchId: { in: branchIds } }, data: { reversalOfId: null } });
  await prisma.journalEntry.deleteMany({ where: { OR: [{ branchId: { in: branchIds } }, { expenseId: { in: expenseIds } }, { orderId: { in: orderIds } }] } });
  await prisma.expense.deleteMany({ where: { id: { in: expenseIds } } });
  await prisma.expenseCategory.deleteMany({ where: { id: { in: [...made.expenseCategoryIds] } } });
  await prisma.cashMovement.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.cashRegisterSession.deleteMany({ where: { id: { in: sessionIds } } });
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
  await prisma.user.deleteMany({ where: { id: { in: [...made.userIds] } } });
  await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });

  console.log("REMAINING", JSON.stringify({ users: await prisma.user.count(), branches: await prisma.branch.count(), orders: await prisma.order.count(), journalEntries: await prisma.journalEntry.count() }));
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
