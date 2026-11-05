import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions } from "../src/lib/db-pool.js";

/**
 * Phase 19 — Insights: the reports, and the audit trail.
 *
 * Two things are proved here.
 *
 * **The audit log respects the branch wall.** An entry names a person, a
 * record and an outlet. Before this phase an unfiltered read handed every
 * branch's activity to anyone who could read one branch's — and the *filter
 * options* leaked too, so the dropdown alone was a staff directory and a
 * readout of what the other outlets had been doing.
 *
 * **A report says what it covers and withholds what it cannot support.**
 * Scoping is invisible: a manager who can see one outlet gets one outlet's
 * figures with nothing on the page saying so, which is how a branch report
 * gets quoted as the company's. And a percentage computed from two
 * deliveries is noise wearing a number's clothes.
 *
 * Start a server first:
 *   APP_URL=http://localhost:3100 CRON_SECRET=phase2-test-secret npx next start -p 3100
 */
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const CRON = process.env.E2E_CRON_SECRET ?? "phase2-test-secret";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });

const stamp = Date.now();
const tag = `e2e19-${stamp}`;
const emailOf = (name) => `${tag}-${name}@example.test`;
const short = String(stamp).slice(-5);
const created = {
  userIds: new Set(),
  branchIds: new Set(),
  roleIds: new Set(),
  productIds: new Set(),
  categoryIds: new Set(),
  expenseCategoryIds: new Set(),
  fiscalYearIds: new Set(),
};

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
const nextIp = () => `10.89.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;

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

async function drain(cycles = 4) {
  for (let i = 0; i < cycles; i++) {
    await fetch(`${BASE}/api/internal/jobs/outbox`, { method: "POST", headers: { authorization: `Bearer ${CRON}` } });
  }
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
  const session = await loginCookies(emailOf(name), password);
  return { id, ...session };
}

const rows = (res) => res.body?.data?.items ?? res.body?.data ?? [];

async function main() {
  // ================= SETUP =================
  const admin = await account("admin", "admin-passphrase-19");
  await prisma.user.update({ where: { id: admin.id }, data: { isSuperAdmin: true } });
  const relogin = await loginCookies(emailOf("admin"), "admin-passphrase-19");
  const adminToken = relogin.token;
  admin.cookie = relogin.cookie;

  const year = new Date().getUTCFullYear();
  const fiscal = await api("/admin/fiscal-years", {
    method: "POST",
    token: adminToken,
    body: { name: `P19 FY ${year} ${short}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` },
  });
  if (fiscal.status === 201) created.fiscalYearIds.add(fiscal.body.data.id);

  const mine = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: `I${short}`, name: `P19 Mine ${short}`, city: "Karachi", timezone: "Asia/Karachi" },
  });
  const theirs = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: `J${short}`, name: `P19 Theirs ${short}`, city: "Lahore", timezone: "Asia/Karachi" },
  });
  check("two branches exist", mine.status === 201 && theirs.status === 201, { mine: mine.body?.error, theirs: theirs.body?.error });
  const mineId = mine.body.data.id;
  const theirsId = theirs.body.data.id;
  created.branchIds.add(mineId);
  created.branchIds.add(theirsId);

  const category = await api("/admin/categories", { method: "POST", token: adminToken, body: { name: `P19 Mains ${short}` } });
  created.categoryIds.add(category.body.data.id);
  const product = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: { name: `P19 Haleem ${short}`, categoryId: category.body.data.id, price: 950.5 },
  });
  const productId = product.body.data.id;
  created.productIds.add(productId);
  await api(`/admin/products/${productId}/publish`, { method: "PUT", token: adminToken, body: { isActive: true } });
  const variant = await prisma.productVariant.findFirst({ where: { productId }, select: { id: true } });

  for (const branchId of [mineId, theirsId]) {
    const menu = await api("/admin/menus", {
      method: "POST",
      token: adminToken,
      body: { branchId, isActive: true, name: `P19 Menu ${short}`, type: "DINE_IN", isDefault: true },
    });
    await api(`/admin/menus/${menu.body.data.id}/items`, { method: "POST", token: adminToken, body: { productId } });
  }

  // ================= SALES AT BOTH BRANCHES, DIFFERENT SIZES ===============
  // Different quantities so "which branch am I looking at" is answerable from
  // the figure itself rather than from trust.
  const sell = async (branchId, quantity) => {
    const order = await api("/admin/orders", {
      method: "POST",
      token: adminToken,
      body: {
        branchId,
        type: "PICKUP",
        channel: "POS",
        guest: { name: "Walk in" },
        items: [{ productId, variantId: variant.id, quantity }],
      },
    });
    const orderId = order.body?.data?.id;
    for (const status of ["CONFIRMED", "PREPARING", "READY", "COMPLETED"]) {
      await api(`/admin/orders/${orderId}/status`, { method: "PUT", token: adminToken, body: { status } });
    }
    return { orderId, total: Number(order.body?.data?.grandTotal ?? 0) };
  };

  const ourSale = await sell(mineId, 2);
  const theirSale = await sell(theirsId, 7);
  check("a completed order at each branch", Boolean(ourSale.orderId && theirSale.orderId), { ours: ourSale, theirs: theirSale });
  check("the other branch sold more, so the two are distinguishable", theirSale.total > ourSale.total, {
    ours: ourSale.total,
    theirs: theirSale.total,
  });
  await drain();

  // ================= AUDIT ENTRIES TAGGED TO EACH BRANCH ===================
  const expenseCategory = await api("/admin/expense-categories", {
    method: "POST",
    token: adminToken,
    body: { name: `P19 Utilities ${short}` },
  });
  if (expenseCategory.status === 201) created.expenseCategoryIds.add(expenseCategory.body.data.id);

  const spend = async (branchId, payee) => {
    const expense = await api("/admin/expenses", {
      method: "POST",
      token: adminToken,
      body: { branchId, categoryId: expenseCategory.body?.data?.id ?? null, payee, amount: 2360, taxAmount: 360 },
    });
    const id = expense.body?.data?.id;
    await api(`/admin/expenses/${id}/submit`, { method: "POST", token: adminToken });
    await api(`/admin/expenses/${id}/approve`, { method: "POST", token: adminToken });
    return id;
  };

  const ourExpenseId = await spend(mineId, `P19 Ours ${short}`);
  const theirExpenseId = await spend(theirsId, `P19 Theirs ${short}`);
  await drain();

  const ourAudit = await prisma.auditLog.findFirst({ where: { entityId: ourExpenseId, branchId: mineId }, select: { id: true, action: true } });
  const theirAudit = await prisma.auditLog.findFirst({ where: { entityId: theirExpenseId, branchId: theirsId }, select: { id: true, action: true } });
  check("approving an expense leaves a branch-tagged audit entry", Boolean(ourAudit && theirAudit), {
    ours: ourAudit,
    theirs: theirAudit,
  });

  // ================= THE REPORTS, UNSCOPED ADMIN ===========================
  const adminSales = await api("/admin/reports/sales", { token: adminToken });
  check("an admin can run the sales report", adminSales.status === 200, adminSales.body?.error);
  const adminRevenue = Number(adminSales.body.data.totals.netSales);
  check("the company figure includes both branches", adminRevenue >= ourSale.total + theirSale.total - 1, {
    adminRevenue,
    expected: ourSale.total + theirSale.total,
  });

  const grouped = await api("/admin/reports/sales?groupBy=month", { token: adminToken });
  check("a series can be bucketed by month", grouped.status === 200 && Array.isArray(grouped.body.data.series), grouped.body?.error);
  check("a month bucket key is a month", (grouped.body.data.series[0]?.period ?? "").length === 7, grouped.body?.data?.series?.[0]);

  const hourly = await api("/admin/reports/sales?groupBy=hour", { token: adminToken });
  check("an hour bucket key is an hour", (hourly.body.data.series[0]?.period ?? "").length === 13, hourly.body?.data?.series?.[0]);

  // ================= THE WALL =================
  const reporter = await account("reporter", "reporter-passphrase-19");
  const role = await api("/admin/roles", {
    method: "POST",
    token: adminToken,
    body: {
      key: `p19-reporter-${short}`,
      name: `P19 Reporter ${short}`,
      permissionKeys: [
        "reports.view_sales",
        "reports.view_inventory",
        "reports.view_delivery",
        "reports.view_hr",
        "audit_logs.read",
        "orders.read",
      ],
    },
  });
  check("a reporting role can be created", role.status === 201, role.body?.error);
  if (role.status === 201) created.roleIds.add(role.body.data.id);
  await api(`/admin/users/${reporter.id}/roles`, { method: "POST", token: adminToken, body: { roleId: role.body.data.id, branchId: mineId } });
  const scoped = await loginCookies(emailOf("reporter"), "reporter-passphrase-19");
  const reporterToken = scoped.token;

  const theirSales = await api("/admin/reports/sales", { token: reporterToken });
  check("a scoped reporter can run the sales report", theirSales.status === 200, theirSales.body?.error);
  const scopedRevenue = Number(theirSales.body.data.totals.netSales);
  check(
    "omitting the branch gives their own outlet, not the company",
    scopedRevenue < adminRevenue,
    { scoped: scopedRevenue, admin: adminRevenue },
  );
  check("the other branch's larger sale is not inside it", adminRevenue - scopedRevenue >= theirSale.total - 1, {
    difference: adminRevenue - scopedRevenue,
    theirs: theirSale.total,
  });

  const namedOther = await api(`/admin/reports/sales?branchId=${theirsId}`, { token: reporterToken });
  check("naming the other branch outright is refused", namedOther.status === 403, { status: namedOther.status });

  // --- the audit trail ---
  const adminLog = await api("/admin/audit-logs?limit=100", { token: adminToken });
  const reporterLog = await api("/admin/audit-logs?limit=100", { token: reporterToken });
  const adminIds = rows(adminLog).map((row) => row.id);
  const reporterIds = rows(reporterLog).map((row) => row.id);

  check("a scoped reporter can read the audit log", reporterLog.status === 200, reporterLog.body?.error);
  check("their own branch's entry is listed", reporterIds.includes(ourAudit.id), { listed: reporterIds.length });
  // The bug this phase exists for.
  check("another branch's entry is NOT listed when the filter is omitted", !reporterIds.includes(theirAudit.id), {
    listed: reporterIds.length,
    leaked: theirAudit.id,
  });
  check("an admin sees both", adminIds.includes(ourAudit.id) && adminIds.includes(theirAudit.id), {
    admin: adminIds.length,
  });

  const reporterBranches = rows(reporterLog).map((row) => row.branch?.id).filter(Boolean);
  check("no row in the scoped log belongs to another branch", !reporterBranches.includes(theirsId), reporterBranches);

  // Company-level entries stay visible: they belong to no outlet, and every
  // other company-wide record in the system is treated the same way.
  const companyRows = rows(reporterLog).filter((row) => !row.branch);
  check("company-level entries are still visible to a scoped reader", companyRows.length > 0, {
    total: reporterIds.length,
  });

  // --- the filter options leak too ---
  const adminActions = await api("/admin/audit-logs/actions", { token: adminToken });
  const reporterActions = await api("/admin/audit-logs/actions", { token: reporterToken });
  check("the action list answers for both", adminActions.status === 200 && reporterActions.status === 200, {
    admin: adminActions.status,
    reporter: reporterActions.status,
  });
  check(
    "the action dropdown is cut to what the reader may see",
    (reporterActions.body.data ?? []).length <= (adminActions.body.data ?? []).length,
    { reporter: (reporterActions.body.data ?? []).length, admin: (adminActions.body.data ?? []).length },
  );

  const byBranch = await api(`/admin/audit-logs?branchId=${theirsId}&limit=50`, { token: reporterToken });
  const leaked = rows(byBranch).filter((row) => row.branch?.id === theirsId);
  check("asking for the other branch by id returns none of its entries", leaked.length === 0, { leaked: leaked.length });

  // ================= PERMISSIONS GATE EACH REPORT SEPARATELY ===============
  const narrow = await account("narrow", "narrow-passphrase-19");
  const narrowRole = await api("/admin/roles", {
    method: "POST",
    token: adminToken,
    body: { key: `p19-narrow-${short}`, name: `P19 Stock only ${short}`, permissionKeys: ["reports.view_inventory"] },
  });
  if (narrowRole.status === 201) created.roleIds.add(narrowRole.body.data.id);
  await api(`/admin/users/${narrow.id}/roles`, { method: "POST", token: adminToken, body: { roleId: narrowRole.body.data.id, branchId: mineId } });
  const narrowSession = await loginCookies(emailOf("narrow"), "narrow-passphrase-19");

  const narrowSales = await api("/admin/reports/sales", { token: narrowSession.token });
  check("a stock-only reader cannot run the sales report", narrowSales.status === 403, { status: narrowSales.status });
  const narrowStock = await api("/admin/reports/inventory", { token: narrowSession.token });
  check("but can run the inventory one", narrowStock.status === 200, narrowStock.body?.error);

  const narrowAudit = await api("/admin/audit-logs", { token: narrowSession.token });
  check("and cannot read the audit log at all", narrowAudit.status === 403, { status: narrowAudit.status });

  // ================= THE SCREENS =================
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
  ];
  for (const path of screens) {
    const res = await page(path, admin.cookie);
    check(`${path} renders`, res.status === 200, { status: res.status, location: res.location });
  }

  const unknown = await page("/dashboard/reports/not-a-report", admin.cookie);
  check("an unknown report is a 404, not a blank page", unknown.status === 404, { status: unknown.status });

  const salesPage = await page("/dashboard/reports/sales", admin.cookie);
  check("a report states what it covers", salesPage.html.includes("All branches"), "no coverage label");
  check("a report states what it excludes", salesPage.html.includes("cancelled order is not a sale"), "no exclusion note");

  const scopedSalesPage = await page("/dashboard/reports/sales", scoped.cookie);
  check(
    "a scoped reader's report names their branch and not the other",
    scopedSalesPage.status === 200 &&
      scopedSalesPage.html.includes(`P19 Mine ${short}`) &&
      !scopedSalesPage.html.includes(`P19 Theirs ${short}`),
    { status: scopedSalesPage.status },
  );

  const auditPage = await page("/dashboard/audit-log", admin.cookie);
  check("the audit screen says how far back the record goes", auditPage.html.includes("the record starts"), "no depth line");

  const scopedAuditPage = await page("/dashboard/audit-log", scoped.cookie);
  check(
    "the scoped audit screen does not name the other branch",
    scopedAuditPage.status === 200 && !scopedAuditPage.html.includes(`P19 Theirs ${short}`),
    { status: scopedAuditPage.status },
  );

  const narrowReports = await page("/dashboard/reports", narrowSession.cookie);
  check("the hub offers only the reports that can be opened", narrowReports.status === 200 && !narrowReports.html.includes("Product mix"), {
    status: narrowReports.status,
  });

  const narrowSalesPage = await page("/dashboard/reports/sales", narrowSession.cookie);
  check("a report they cannot open sends them back rather than refusing", [302, 307].includes(narrowSalesPage.status), {
    status: narrowSalesPage.status,
  });

  const outsider = await account("outsider", "outsider-passphrase-19");
  const outsiderPage = await page("/dashboard/audit-log", outsider.cookie);
  check("someone with no reporting permission is sent away", [302, 307].includes(outsiderPage.status), {
    status: outsiderPage.status,
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));
}

async function cleanup() {
  const branchIds = [...created.branchIds];
  const orderIds = (await prisma.order.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((r) => r.id);
  const expenseIds = (await prisma.expense.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((r) => r.id);

  await prisma.journalLine.deleteMany({
    where: { entry: { OR: [{ branchId: { in: branchIds } }, { expenseId: { in: expenseIds } }, { orderId: { in: orderIds } }] } },
  });
  await prisma.journalEntry.deleteMany({
    where: { OR: [{ branchId: { in: branchIds } }, { expenseId: { in: expenseIds } }, { orderId: { in: orderIds } }] },
  });
  await prisma.expense.deleteMany({ where: { id: { in: expenseIds } } });
  await prisma.expenseCategory.deleteMany({ where: { id: { in: [...created.expenseCategoryIds] } } });

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
    await prisma.accountingPeriod.findMany({ where: { fiscalYearId: { in: [...created.fiscalYearIds] } }, select: { id: true } })
  ).map((row) => row.id);
  await prisma.journalLine.deleteMany({ where: { entry: { periodId: { in: ownPeriodIds } } } });
  await prisma.journalEntry.deleteMany({ where: { periodId: { in: ownPeriodIds } } });
  await prisma.accountingPeriod.deleteMany({ where: { id: { in: ownPeriodIds } } });
  await prisma.fiscalYear.deleteMany({ where: { id: { in: [...created.fiscalYearIds] } } });

  await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: [...created.userIds] } } } });
  await prisma.cart.deleteMany({ where: { userId: { in: [...created.userIds] } } });
  await prisma.menuItem.deleteMany({ where: { menu: { branchId: { in: branchIds } } } });
  await prisma.menuSection.deleteMany({ where: { menu: { branchId: { in: branchIds } } } });
  await prisma.menu.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.menuItem.deleteMany({ where: { productId: { in: [...created.productIds] } } });
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
      products: await prisma.product.count(),
      roles: await prisma.role.count(),
      accounts: await prisma.account.count(),
      auditLogs: await prisma.auditLog.count(),
      journalEntries: await prisma.journalEntry.count(),
      fiscalYears: await prisma.fiscalYear.count(),
    }),
  );
}

try {
  await main();
} catch (error) {
  console.error("PHASE 19 CRASHED", error);
  failures.push("crashed");
} finally {
  await cleanup().catch((error) => console.error("CLEANUP FAILED", error));
  await prisma.$disconnect();
}

process.exit(failures.length ? 1 : 0);
