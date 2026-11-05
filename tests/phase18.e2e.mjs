import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions } from "../src/lib/db-pool.js";

/**
 * Phase 18 — Finance: the money in, the money out, and the books behind both.
 *
 * Three things are proved here.
 *
 * **The branch wall, in its sharpest form.** Every other section leaked a
 * list. Finance leaked the *statements*. Naming a branch you may not see was
 * already refused — but naming none at all was permitted, and the
 * company-wide profit and loss that came back included the branch you had
 * just been refused. The same hole ran through the balance sheet, the trial
 * balance, cash flow, every list and the drill-down behind every figure.
 *
 * **Company data versus branch data.** A period, a tax rate and a shared
 * account belong to the whole company, so a grant pinned to one outlet must
 * not be able to close the books or change the VAT for all of them.
 *
 * **The flows themselves**, end to end: a drawer opened, taken against,
 * counted short and signed off; an expense drafted, approved and landing in
 * the ledger; a manual entry posted and reversed; a refund requested and
 * approved.
 *
 * Start a server first:
 *   APP_URL=http://localhost:3100 CRON_SECRET=phase2-test-secret npx next start -p 3100
 */
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const CRON = process.env.E2E_CRON_SECRET ?? "phase2-test-secret";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });

const stamp = Date.now();
const tag = `e2e18-${stamp}`;
const emailOf = (name) => `${tag}-${name}@example.test`;
const short = String(stamp).slice(-5);
const created = {
  userIds: new Set(),
  branchIds: new Set(),
  roleIds: new Set(),
  productIds: new Set(),
  categoryIds: new Set(),
  expenseCategoryIds: new Set(),
  taxGroupIds: new Set(),
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
const nextIp = () => `10.87.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;

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

/**
 * Drains the outbox until it stops producing work.
 *
 * One cycle is not enough. The sale posting is enqueued *by* the
 * status-changed handler, so it does not exist until that handler has
 * already run — a single drain leaves revenue out of the ledger and every
 * statement reading zero.
 */
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
const ids = (res) => rows(res).map((row) => row.id);

async function main() {
  // ================= SETUP =================
  const admin = await account("admin", "admin-passphrase-18");
  await prisma.user.update({ where: { id: admin.id }, data: { isSuperAdmin: true } });
  const relogin = await loginCookies(emailOf("admin"), "admin-passphrase-18");
  const adminToken = relogin.token;
  admin.cookie = relogin.cookie;

  const mine = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: `F${short}`, name: `P18 Mine ${short}`, city: "Karachi", timezone: "Asia/Karachi" },
  });
  const theirs = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: `G${short}`, name: `P18 Theirs ${short}`, city: "Lahore", timezone: "Asia/Karachi" },
  });
  check("two branches exist", mine.status === 201 && theirs.status === 201, { mine: mine.body?.error, theirs: theirs.body?.error });
  const mineId = mine.body.data.id;
  const theirsId = theirs.body.data.id;
  created.branchIds.add(mineId);
  created.branchIds.add(theirsId);

  // Nothing can post to the ledger without a period to post into, and the
  // seeded database has no fiscal year. Created here, and removed again in
  // cleanup, because leaving one behind is configuration this test invented.
  const year = new Date().getUTCFullYear();
  const fiscal = await api("/admin/fiscal-years", {
    method: "POST",
    token: adminToken,
    body: { name: `P18 FY ${year} ${short}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` },
  });
  /*
   * Either this suite opened the year or the company already has one covering
   * today — both leave the months this suite needs to post into. A 409 is the
   * overlap guard doing its job, not a failure, and the id is recorded only
   * when we really created it so cleanup never deletes the company's books.
   */
  check(
    "there are months to post into",
    fiscal.status === 201 || fiscal.status === 409,
    fiscal.body?.error,
  );
  if (fiscal.status === 201) created.fiscalYearIds.add(fiscal.body.data.id);

  const category = await api("/admin/categories", { method: "POST", token: adminToken, body: { name: `P18 Mains ${short}` } });
  created.categoryIds.add(category.body.data.id);
  const product = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    // 1199.99 on purpose: a two-decimal price the old float validator refused.
    body: { name: `P18 Biryani ${short}`, categoryId: category.body.data.id, price: 1199.99 },
  });
  check("a two-decimal price is accepted by the catalog", product.status === 201, product.body?.error);
  const productId = product.body.data.id;
  created.productIds.add(productId);
  await api(`/admin/products/${productId}/publish`, { method: "PUT", token: adminToken, body: { isActive: true } });
  const variant = await prisma.productVariant.findFirst({ where: { productId }, select: { id: true } });

  for (const branchId of [mineId, theirsId]) {
    const menu = await api("/admin/menus", {
      method: "POST",
      token: adminToken,
      body: { branchId, isActive: true, name: `P18 Menu ${short}`, type: "DINE_IN", isDefault: true },
    });
    await api(`/admin/menus/${menu.body.data.id}/items`, { method: "POST", token: adminToken, body: { productId } });
  }

  // ================= A DRAWER, A SALE, AND A COUNT =================
  const openDrawer = async (branchId, name) =>
    api("/admin/registers", { method: "POST", token: adminToken, body: { branchId, registerName: name, openingFloat: 5000 } });

  const ourSession = await openDrawer(mineId, `till-${short}`);
  const theirSession = await openDrawer(theirsId, `till-x-${short}`);
  check("a drawer opens at each branch", ourSession.status === 201 && theirSession.status === 201, {
    ours: ourSession.body?.error,
    theirs: theirSession.body?.error,
  });
  const ourSessionId = ourSession.body.data.id;
  const theirSessionId = theirSession.body.data.id;

  const secondOpen = await openDrawer(mineId, `till-${short}`);
  check("the same drawer cannot be opened twice", secondOpen.status === 409, { status: secondOpen.status });

  const placeOrder = async (branchId) =>
    api("/admin/orders", {
      method: "POST",
      token: adminToken,
      body: {
        branchId,
        type: "PICKUP",
        channel: "POS",
        guest: { name: "Walk in" },
        items: [{ productId, variantId: variant.id, quantity: 2 }],
      },
    });

  const ourOrder = await placeOrder(mineId);
  const theirOrder = await placeOrder(theirsId);
  check("an order at each branch", ourOrder.status === 201 && theirOrder.status === 201, { ours: ourOrder.body?.error, theirs: theirOrder.body?.error });
  const ourOrderId = ourOrder.body.data.id;
  const theirOrderId = theirOrder.body.data.id;
  const orderTotal = Number(ourOrder.body.data.grandTotal);
  check("the order total carries the two-decimal price through", orderTotal > 2399 && orderTotal < 2401, { orderTotal });

  const ourPayment = await api("/admin/payments", {
    method: "POST",
    token: adminToken,
    body: { orderId: ourOrderId, method: "CASH", registerSessionId: ourSessionId },
  });
  const theirPayment = await api("/admin/payments", {
    method: "POST",
    token: adminToken,
    body: { orderId: theirOrderId, method: "CASH", registerSessionId: theirSessionId },
  });
  check("a cash payment at each branch", ourPayment.status === 201 && theirPayment.status === 201, {
    ours: ourPayment.body?.error,
    theirs: theirPayment.body?.error,
  });
  const ourPaymentId = ourPayment.body.data.payment?.id ?? ourPayment.body.data.id;
  const theirPaymentId = theirPayment.body.data.payment?.id ?? theirPayment.body.data.id;

  const collected = await api(`/admin/payments/${ourPaymentId}/collect`, {
    method: "POST",
    token: adminToken,
    body: { registerSessionId: ourSessionId },
  });
  check("cash is marked collected into the drawer", collected.status === 200, collected.body?.error);
  await api(`/admin/payments/${theirPaymentId}/collect`, { method: "POST", token: adminToken, body: { registerSessionId: theirSessionId } });

  // A pay-out, sent positive. The server decides the sign from the type.
  const payOut = await api(`/admin/registers/${ourSessionId}/movements`, {
    method: "POST",
    token: adminToken,
    body: { type: "PAY_OUT", amount: 300, reason: "Cleaner" },
  });
  check("a pay-out is recorded from a positive amount", payOut.status === 201, payOut.body?.error);

  const negative = await api(`/admin/registers/${ourSessionId}/movements`, {
    method: "POST",
    token: adminToken,
    body: { type: "PAY_IN", amount: -50 },
  });
  check("a negative amount is refused rather than trusted", negative.status === 400, { status: negative.status });

  const unexplained = await api(`/admin/registers/${ourSessionId}/movements`, {
    method: "POST",
    token: adminToken,
    body: { type: "ADJUSTMENT", amount: 100 },
  });
  check("an adjustment without a reason is refused", unexplained.status === 400, { status: unexplained.status });

  const beforeClose = await api(`/admin/registers/${ourSessionId}`, { token: adminToken });
  const expected = Number(beforeClose.body.data.expectedCash);
  // 5000 float + the sale - 300 paid out.
  check("the drawer expects the float plus the sale less the pay-out", Math.abs(expected - (5000 + orderTotal - 300)) < 0.01, {
    expected,
    orderTotal,
  });

  const closed = await api(`/admin/registers/${ourSessionId}/close`, {
    method: "POST",
    token: adminToken,
    body: { countedCash: expected - 200, notes: "Counted twice" },
  });
  check("the drawer closes against a counted figure", closed.status === 200, closed.body?.error);
  check("a short drawer records a negative variance", Number(closed.body.data.variance) < 0, { variance: closed.body?.data?.variance });

  const reconciled = await api(`/admin/registers/${ourSessionId}/reconcile`, { method: "POST", token: adminToken, body: {} });
  check("a counted drawer can be signed off", reconciled.status === 200, reconciled.body?.error);

  // ================= A REFUND, REQUESTED AND APPROVED =================
  const refundRequest = await api("/admin/refunds", {
    method: "POST",
    token: adminToken,
    body: { paymentId: ourPaymentId, amount: 500, reason: "One dish sent back" },
  });
  check("a refund can be requested against a captured payment", refundRequest.status === 201, refundRequest.body?.error);
  const ourRefundId = refundRequest.body?.data?.id;

  const theirRefund = await api("/admin/refunds", {
    method: "POST",
    token: adminToken,
    body: { paymentId: theirPaymentId, amount: 100, reason: "Other branch refund" },
  });
  const theirRefundId = theirRefund.body?.data?.id;

  const overRefund = await api("/admin/refunds", {
    method: "POST",
    token: adminToken,
    body: { paymentId: ourPaymentId, amount: orderTotal * 2, reason: "More than was ever taken" },
  });
  check("a refund larger than the payment is refused", overRefund.status >= 400, { status: overRefund.status });

  const approved = await api(`/admin/refunds/${ourRefundId}/approve`, { method: "POST", token: adminToken });
  check("a refund can be approved", approved.status === 200, approved.body?.error);

  // ================= AN EXPENSE INTO THE LEDGER =================
  const expenseCategory = await api("/admin/expense-categories", {
    method: "POST",
    token: adminToken,
    body: { name: `P18 Utilities ${short}` },
  });
  check("an expense category can be created", expenseCategory.status === 201, expenseCategory.body?.error);
  if (expenseCategory.status === 201) created.expenseCategoryIds.add(expenseCategory.body.data.id);

  const makeExpense = async (branchId) =>
    api("/admin/expenses", {
      method: "POST",
      token: adminToken,
      body: {
        branchId,
        categoryId: expenseCategory.body?.data?.id ?? null,
        payee: "Electricity board",
        // 1180 off the receipt, 180 of which is tax — the gross, as the
        // posting rule reads it.
        amount: 1180,
        taxAmount: 180,
        description: "Monthly bill",
      },
    });

  const ourExpense = await makeExpense(mineId);
  const theirExpense = await makeExpense(theirsId);
  check("an expense at each branch", ourExpense.status === 201 && theirExpense.status === 201, {
    ours: ourExpense.body?.error,
    theirs: theirExpense.body?.error,
  });
  const ourExpenseId = ourExpense.body.data.id;
  const theirExpenseId = theirExpense.body.data.id;
  check("a new expense is a draft, not yet a cost", ourExpense.body.data.status === "DRAFT", ourExpense.body?.data?.status);

  await api(`/admin/expenses/${ourExpenseId}/submit`, { method: "POST", token: adminToken });
  const approveExpense = await api(`/admin/expenses/${ourExpenseId}/approve`, { method: "POST", token: adminToken });
  check("an expense can be approved", approveExpense.status === 200, approveExpense.body?.error);

  await drain();

  const expenseEntry = await prisma.journalEntry.findFirst({
    where: { expenseId: ourExpenseId, status: "POSTED" },
    select: { id: true, totalDebit: true, lines: { select: { debit: true, credit: true, account: { select: { code: true } } } } },
  });
  check("approving an expense posts it to the ledger", Boolean(expenseEntry), { expenseId: ourExpenseId });

  if (expenseEntry) {
    const credit = expenseEntry.lines.find((line) => Number(line.credit) > 0);
    const taxLine = expenseEntry.lines.find((line) => line.account.code === "2200" && Number(line.debit) > 0);
    const costLine = expenseEntry.lines.find((line) => Number(line.debit) > 0 && line.account.code !== "2200");
    // The whole point of the tax model: 1180 left the bank, 1000 was the
    // cost, 180 was recoverable input tax.
    check("the whole receipt is credited to where it was paid from", Math.abs(Number(credit?.credit ?? 0) - 1180) < 0.01, {
      credit: credit?.credit,
    });
    check("the tax inside it is split out as recoverable", Math.abs(Number(taxLine?.debit ?? 0) - 180) < 0.01, { tax: taxLine?.debit });
    check("the cost is the receipt less that tax, not the receipt plus it", Math.abs(Number(costLine?.debit ?? 0) - 1000) < 0.01, {
      cost: costLine?.debit,
    });
  }

  // ================= A MANUAL ENTRY, POSTED AND REVERSED =================
  const cashAccount = await prisma.account.findFirst({ where: { code: "1100" }, select: { id: true } });
  const otherExpense = await prisma.account.findFirst({ where: { code: "5990" }, select: { id: true } });

  const unbalanced = await api("/admin/journal-entries", {
    method: "POST",
    token: adminToken,
    body: {
      branchId: mineId,
      memo: "Does not balance",
      lines: [
        { accountId: otherExpense.id, debit: 100 },
        { accountId: cashAccount.id, credit: 60 },
      ],
      post: true,
    },
  });
  check("an unbalanced entry cannot be posted", unbalanced.status >= 400, { status: unbalanced.status });

  const bothSides = await api("/admin/journal-entries", {
    method: "POST",
    token: adminToken,
    body: {
      branchId: mineId,
      memo: "A line on both sides",
      lines: [
        { accountId: otherExpense.id, debit: 100, credit: 100 },
        { accountId: cashAccount.id, credit: 100 },
      ],
    },
  });
  check("a line cannot be a debit and a credit at once", bothSides.status === 400, { status: bothSides.status });

  const manual = await api("/admin/journal-entries", {
    method: "POST",
    token: adminToken,
    body: {
      branchId: mineId,
      memo: `P18 correction ${short}`,
      lines: [
        { accountId: otherExpense.id, debit: 250 },
        { accountId: cashAccount.id, credit: 250 },
      ],
    },
  });
  check("a balanced manual entry saves as a draft", manual.status === 201, manual.body?.error);
  const manualId = manual.body.data.id;
  check("a new manual entry is not in the books yet", manual.body.data.status === "DRAFT", manual.body?.data?.status);

  const theirManual = await api("/admin/journal-entries", {
    method: "POST",
    token: adminToken,
    body: {
      branchId: theirsId,
      memo: `P18 other branch ${short}`,
      lines: [
        { accountId: otherExpense.id, debit: 900 },
        { accountId: cashAccount.id, credit: 900 },
      ],
      post: true,
    },
  });
  const theirEntryId = theirManual.body?.data?.id;
  check("the other branch has a posted entry too", theirManual.status === 201, theirManual.body?.error);

  const posted = await api(`/admin/journal-entries/${manualId}/post`, { method: "POST", token: adminToken });
  check("a draft can be posted", posted.status === 200, posted.body?.error);

  const reversed = await api(`/admin/journal-entries/${manualId}/reverse`, { method: "POST", token: adminToken, body: {} });
  // 201: reversing writes a *new* entry rather than changing this one.
  check("a posted entry is reversed, not edited", reversed.status === 201, { status: reversed.status, error: reversed.body?.error });
  const reversalId = reversed.body?.data?.id;
  // The response has to carry the link it just made, or a client cannot tell
  // that what it is holding is a reversal.
  check("the reversal points back at the original", reversed.body?.data?.reversalOfId === manualId, reversed.body?.data?.reversalOfId);

  const voidPosted = await api(`/admin/journal-entries/${manualId}/void`, { method: "POST", token: adminToken, body: {} });
  check("a posted entry cannot simply be voided", voidPosted.status >= 400, { status: voidPosted.status });

  // ================= THE BOOKS ADD UP =================
  const audit = await api("/admin/journal-entries/audit", { token: adminToken });
  check("the ledger audit reports every entry balancing", audit.status === 200 && audit.body?.data?.balanced !== false, audit.body?.data);

  const adminTrial = await api("/admin/reports/trial-balance", { token: adminToken });
  check("the trial balance agrees for the whole company", adminTrial.status === 200 && adminTrial.body.data.balanced === true, {
    debit: adminTrial.body?.data?.totalDebit,
    credit: adminTrial.body?.data?.totalCredit,
  });

  // ================= AN INVOICE =================
  // A pending order has not been agreed to yet, so there is nothing to
  // invoice for. Both are moved on before asking.
  for (const orderId of [ourOrderId, theirOrderId]) {
    for (const status of ["CONFIRMED", "PREPARING", "READY", "COMPLETED"]) {
      await api(`/admin/orders/${orderId}/status`, { method: "PUT", token: adminToken, body: { status } });
    }
  }
  await drain();

  const invoice = await api(`/admin/orders/${ourOrderId}/invoice`, {
    method: "POST",
    token: adminToken,
    body: { billing: { name: "Acme Catering", taxId: "NTN-12345" } },
  });
  check("an invoice can be issued against an order", invoice.status === 201 || invoice.status === 200, invoice.body?.error);

  const theirInvoice = await api(`/admin/orders/${theirOrderId}/invoice`, {
    method: "POST",
    token: adminToken,
    body: { billing: { name: "Other Branch Co" } },
  });

  const invoiceList = await api("/admin/invoices?limit=100", { token: adminToken });
  check("the new invoices list endpoint answers", invoiceList.status === 200, invoiceList.body?.error);
  check("both invoices are listed for an admin", rows(invoiceList).length >= 2, rows(invoiceList).length);

  // ================= THE WALL =================
  const clerk = await account("clerk", "clerk-passphrase-18");
  const role = await api("/admin/roles", {
    method: "POST",
    token: adminToken,
    body: {
      key: `p18-clerk-${short}`,
      name: `P18 Finance clerk ${short}`,
      permissionKeys: [
        "payments.read",
        "refunds.read",
        "expenses.read",
        "expenses.approve",
        "cash_registers.read",
        "journal_entries.read",
        "invoices.read",
        "accounts.read",
        "accounting_periods.read",
        "accounting_periods.close",
        "taxes.read",
        "taxes.manage",
        "financial_reports.view_pnl",
        "financial_reports.view_balance_sheet",
        "financial_reports.view_trial_balance",
        "financial_reports.view_cash_flow",
        "orders.read",
      ],
    },
  });
  check("a finance role can be created", role.status === 201, role.body?.error);
  if (role.status === 201) created.roleIds.add(role.body.data.id);
  // Pinned to one branch. Every grant above is held *there* and nowhere else.
  await api(`/admin/users/${clerk.id}/roles`, { method: "POST", token: adminToken, body: { roleId: role.body.data.id, branchId: mineId } });
  const scoped = await loginCookies(emailOf("clerk"), "clerk-passphrase-18");
  const clerkToken = scoped.token;

  const lists = [
    ["payments", "/admin/payments?limit=100", ourPaymentId, theirPaymentId],
    ["refunds", "/admin/refunds?limit=100", ourRefundId, theirRefundId],
    ["expenses", "/admin/expenses?limit=100", ourExpenseId, theirExpenseId],
    ["registers", "/admin/registers?limit=100", ourSessionId, theirSessionId],
    ["journal entries", "/admin/journal-entries?limit=100", manualId, theirEntryId],
  ];

  for (const [label, path, ours, theirs2] of lists) {
    const list = await api(path, { token: clerkToken });
    const listed = ids(list);
    check(`a scoped clerk can list ${label}`, list.status === 200, list.body?.error);
    check(`their own branch's ${label} row is listed`, listed.includes(ours), { listed: listed.length });
    // The bug this phase exists for: omit the filter, get the whole company.
    check(`another branch's ${label} row is NOT listed when the filter is omitted`, !listed.includes(theirs2), {
      listed: listed.length,
      leaked: theirs2,
    });
  }

  const invoicesForClerk = await api("/admin/invoices?limit=100", { token: clerkToken });
  const clerkInvoiceBranches = rows(invoicesForClerk).map((row) => row.order?.branchId);
  check("the invoice list is cut to the clerk's branches", !clerkInvoiceBranches.includes(theirsId), clerkInvoiceBranches);

  const reachable = [
    ["payment", `/admin/payments/${theirPaymentId}`],
    ["refund", `/admin/refunds/${theirRefundId}`],
    ["expense", `/admin/expenses/${theirExpenseId}`],
    ["register session", `/admin/registers/${theirSessionId}`],
    ["journal entry", `/admin/journal-entries/${theirEntryId}`],
  ];

  for (const [label, path] of reachable) {
    const direct = await api(path, { token: clerkToken });
    // 404, not 403: a 403 confirms the id is real, which is itself the leak.
    check(`another branch's ${label} is a 404 by direct id`, direct.status === 404, { status: direct.status });
  }

  const ownPayment = await api(`/admin/payments/${ourPaymentId}`, { token: clerkToken });
  check("their own branch's payment still opens", ownPayment.status === 200, ownPayment.body?.error);

  // --- the statements, which is where this leak was worst ---
  const theirEntryTotal = 900;

  const clerkTrial = await api("/admin/reports/trial-balance", { token: clerkToken });
  // Re-read as the admin *now*: comparing against the figure taken earlier
  // would be a comparison across time, not across scope.
  const adminTrialNow = await api("/admin/reports/trial-balance", { token: adminToken });
  const adminTrialTotal = Number(adminTrialNow.body.data.totalDebit);
  const clerkTrialTotal = Number(clerkTrial.body.data.totalDebit);
  check("a scoped clerk can run a trial balance", clerkTrial.status === 200, clerkTrial.body?.error);
  check("the scoped trial balance is smaller than the company's", clerkTrialTotal < adminTrialTotal, {
    clerk: clerkTrialTotal,
    admin: adminTrialTotal,
  });
  check("the other branch's entry is not inside it", adminTrialTotal - clerkTrialTotal >= theirEntryTotal, {
    difference: adminTrialTotal - clerkTrialTotal,
  });
  check("a scoped trial balance still balances", clerkTrial.body.data.balanced === true, {
    debit: clerkTrial.body?.data?.totalDebit,
    credit: clerkTrial.body?.data?.totalCredit,
  });

  const clerkPnl = await api("/admin/reports/profit-and-loss", { token: clerkToken });
  const adminPnl = await api("/admin/reports/profit-and-loss", { token: adminToken });
  check("a scoped clerk can run a profit and loss", clerkPnl.status === 200, clerkPnl.body?.error);
  check(
    "the company's revenue is not handed over when no branch is named",
    Number(clerkPnl.body.data.grossRevenue) < Number(adminPnl.body.data.grossRevenue),
    { clerk: clerkPnl.body?.data?.grossRevenue, admin: adminPnl.body?.data?.grossRevenue },
  );

  const clerkSheet = await api("/admin/reports/balance-sheet", { token: clerkToken });
  const adminSheet = await api("/admin/reports/balance-sheet", { token: adminToken });
  check(
    "the balance sheet is cut the same way",
    clerkSheet.status === 200 && Number(clerkSheet.body.data.totalAssets) !== Number(adminSheet.body.data.totalAssets),
    { clerk: clerkSheet.body?.data?.totalAssets, admin: adminSheet.body?.data?.totalAssets },
  );
  check("a scoped balance sheet still balances", clerkSheet.body.data.balanced === true, {
    difference: clerkSheet.body?.data?.difference,
  });

  const clerkCash = await api("/admin/reports/cash-flow", { token: clerkToken });
  const adminCash = await api("/admin/reports/cash-flow", { token: adminToken });
  check(
    "cash flow is cut the same way",
    clerkCash.status === 200 && Number(clerkCash.body.data.outflow) < Number(adminCash.body.data.outflow),
    { clerk: clerkCash.body?.data?.outflow, admin: adminCash.body?.data?.outflow },
  );

  const namedOther = await api(`/admin/reports/profit-and-loss?branchId=${theirsId}`, { token: clerkToken });
  check("naming the other branch outright is still refused", namedOther.status === 403, { status: namedOther.status });

  // --- the drill-down behind a figure ---
  const clerkLedger = await api(`/admin/accounts/${otherExpense.id}/ledger`, { token: clerkToken });
  const adminLedger = await api(`/admin/accounts/${otherExpense.id}/ledger`, { token: adminToken });
  check("a scoped clerk can open an account's ledger", clerkLedger.status === 200, clerkLedger.body?.error);
  check(
    "the ledger behind a figure is cut like the figure was",
    (clerkLedger.body.data.movements ?? []).length < (adminLedger.body.data.movements ?? []).length,
    { clerk: clerkLedger.body?.data?.movements?.length, admin: adminLedger.body?.data?.movements?.length },
  );
  const clerkEntryNumbers = (clerkLedger.body.data.movements ?? []).map((row) => row.entryNumber);
  const theirEntryNumber = theirManual.body?.data?.entryNumber;
  check("the other branch's entry does not appear in the drill-down", !clerkEntryNumbers.includes(theirEntryNumber), {
    theirEntryNumber,
  });

  // ================= COMPANY DATA NEEDS A COMPANY-WIDE GRANT =================
  const taxGroup = await api("/admin/tax-groups", {
    method: "POST",
    token: clerkToken,
    body: { name: `P18 Branch VAT ${short}`, isInclusive: true },
  });
  check("a branch-pinned grant cannot create a tax group every branch uses", taxGroup.status === 403, { status: taxGroup.status });

  const adminTaxGroup = await api("/admin/tax-groups", {
    method: "POST",
    token: adminToken,
    body: { name: `P18 VAT ${short}`, isInclusive: true },
  });
  check("a company-wide grant can", adminTaxGroup.status === 201, adminTaxGroup.body?.error);
  if (adminTaxGroup.status === 201) created.taxGroupIds.add(adminTaxGroup.body.data.id);

  const rate = await api(`/admin/tax-groups/${adminTaxGroup.body.data.id}/rates`, {
    method: "POST",
    token: adminToken,
    body: { name: "GST", rate: 17.5 },
  });
  check("a rate with a fractional percentage is accepted", rate.status === 201, rate.body?.error);

  const clerkRate = await api(`/admin/tax-groups/${adminTaxGroup.body.data.id}/rates`, {
    method: "POST",
    token: clerkToken,
    body: { name: "Sneaky", rate: 1 },
  });
  check("a branch-pinned grant cannot add a rate either", clerkRate.status === 403, { status: clerkRate.status });

  const period = await prisma.accountingPeriod.findFirst({ where: { status: "OPEN" }, select: { id: true } });
  if (period) {
    const clerkClose = await api(`/admin/accounting-periods/${period.id}/close`, { method: "POST", token: clerkToken });
    check("a branch-pinned grant cannot close the books for every branch", clerkClose.status === 403, { status: clerkClose.status });
  } else {
    check("a branch-pinned grant cannot close the books for every branch", true, "no open period to try against");
  }

  const clerkAccount = await api("/admin/accounts", {
    method: "POST",
    token: clerkToken,
    body: { code: `99${short}`.slice(0, 8), name: "Sneaky account", type: "EXPENSE", normalBalance: "DEBIT" },
  });
  check("a branch-pinned grant cannot add an account to the shared chart", clerkAccount.status === 403, { status: clerkAccount.status });

  // ================= THE SCREENS =================
  const screens = [
    "/dashboard/payments",
    `/dashboard/payments/${ourPaymentId}`,
    "/dashboard/refunds",
    `/dashboard/refunds/${ourRefundId}`,
    "/dashboard/invoices",
    "/dashboard/registers",
    `/dashboard/registers/${ourSessionId}`,
    "/dashboard/expenses",
    "/dashboard/expenses/new",
    `/dashboard/expenses/${ourExpenseId}`,
    "/dashboard/accounts",
    "/dashboard/accounts/new",
    `/dashboard/accounts/${otherExpense.id}`,
    "/dashboard/journal",
    "/dashboard/journal/new",
    `/dashboard/journal/${manualId}`,
    "/dashboard/periods",
    "/dashboard/taxes",
    "/dashboard/financial-reports",
    "/dashboard/financial-reports/profit-and-loss",
    "/dashboard/financial-reports/balance-sheet",
    "/dashboard/financial-reports/trial-balance",
    "/dashboard/financial-reports/cash-flow",
  ];

  for (const path of screens) {
    const res = await page(path, admin.cookie);
    check(`${path} renders`, res.status === 200, { status: res.status, location: res.location });
  }

  const pnlPage = await page("/dashboard/financial-reports/profit-and-loss", admin.cookie);
  check("a statement states what it covers", pnlPage.html.includes("All branches"), "no coverage label on the page");

  const clerkPnlPage = await page("/dashboard/financial-reports/profit-and-loss", scoped.cookie);
  check(
    "a scoped reader's statement says it is only their branch",
    clerkPnlPage.status === 200 && clerkPnlPage.html.includes(`P18 Mine ${short}`) && !clerkPnlPage.html.includes(`P18 Theirs ${short}`),
    { status: clerkPnlPage.status },
  );

  const reversalPage = await page(`/dashboard/journal/${reversalId}`, admin.cookie);
  check("a reversal says what it undoes", reversalPage.status === 200 && reversalPage.html.includes("undo another one"), {
    status: reversalPage.status,
  });

  const expensePage = await page(`/dashboard/expenses/${ourExpenseId}`, admin.cookie);
  check("the expense screen shows the tax as inside the total", expensePage.html.includes("Of which tax"), "tax shown as an addition");

  // A clerk with no refunds permission at all must not reach the screen.
  const outsider = await account("outsider", "outsider-passphrase-18");
  const outsiderPage = await page("/dashboard/payments", outsider.cookie);
  check("someone with no finance permission is sent away", outsiderPage.status === 307 || outsiderPage.status === 302, {
    status: outsiderPage.status,
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));
}

async function cleanup() {
  const branchIds = [...created.branchIds];
  const orderIds = (await prisma.order.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((r) => r.id);
  const sessionIds = (await prisma.cashRegisterSession.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((r) => r.id);
  const expenseIds = (await prisma.expense.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((r) => r.id);

  await prisma.journalLine.deleteMany({
    where: { entry: { OR: [{ branchId: { in: branchIds } }, { expenseId: { in: expenseIds } }, { orderId: { in: orderIds } }] } },
  });
  await prisma.journalEntry.updateMany({
    where: { reversalOfId: { not: null }, branchId: { in: branchIds } },
    data: { reversalOfId: null },
  });
  await prisma.journalEntry.deleteMany({
    where: { OR: [{ branchId: { in: branchIds } }, { expenseId: { in: expenseIds } }, { orderId: { in: orderIds } }] },
  });

  await prisma.expense.deleteMany({ where: { id: { in: expenseIds } } });
  await prisma.expenseCategory.deleteMany({ where: { id: { in: [...created.expenseCategoryIds] } } });

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

  await prisma.taxRate.deleteMany({ where: { groupId: { in: [...created.taxGroupIds] } } });
  await prisma.taxGroup.deleteMany({ where: { id: { in: [...created.taxGroupIds] } } });

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
      payments: await prisma.payment.count(),
      refunds: await prisma.refund.count(),
      expenses: await prisma.expense.count(),
      sessions: await prisma.cashRegisterSession.count(),
      journalEntries: await prisma.journalEntry.count(),
      invoices: await prisma.invoice.count(),
      accounts: await prisma.account.count(),
      taxGroups: await prisma.taxGroup.count(),
      fiscalYears: await prisma.fiscalYear.count(),
      products: await prisma.product.count(),
      roles: await prisma.role.count(),
    }),
  );
}

try {
  await main();
} catch (error) {
  console.error("PHASE 18 CRASHED", error);
  failures.push("crashed");
} finally {
  await cleanup().catch((error) => console.error("CLEANUP FAILED", error));
  await prisma.$disconnect();
}

process.exit(failures.length ? 1 : 0);
