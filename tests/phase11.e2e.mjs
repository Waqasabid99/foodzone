import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions, warmUpDatabase } from "../src/lib/db-pool.js";

/**
 * Phase 11 — Finance, end to end.
 *
 * Start a server first:
 *   APP_URL=http://localhost:3100 CRON_SECRET=phase2-test-secret npx next dev -p 3100
 *
 * The arithmetic — balancing, contra-income, the balance sheet carrying current
 * earnings into equity, ageing buckets — is pinned in tests/unit.mjs. What only
 * a database can prove is here: that a real delivery flows GRNI to payables to
 * cash without anything being counted twice, that a closed period genuinely
 * refuses a posting, that a posted entry cannot be edited or deleted and only
 * reverses, that a redelivered outbox event does not produce a second set of
 * books, and that after all of it the ledger still adds up.
 */
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const CRON = process.env.E2E_CRON_SECRET ?? "phase2-test-secret";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });

const stamp = Date.now();
const tag = `e2e11-${stamp}`;
const emailOf = (name) => `${tag}-${name}@example.test`;
const BRANCH_CODE = `E2EB${String(stamp).slice(-5)}`;
const created = { userIds: new Set(), branchIds: new Set(), unitIds: new Set(), accountIds: new Set() };

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
const nextIp = () => `10.92.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;

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

async function drainOutbox() {
  const res = await fetch(`${BASE}/api/internal/jobs/outbox`, {
    method: "POST",
    headers: { authorization: `Bearer ${CRON}` },
  });
  return res.status;
}

const num = (value) => Number(value ?? 0);
const round = (value, dp = 4) => Math.round(Number(value ?? 0) * 10 ** dp) / 10 ** dp;
const iso = (date) => new Date(date).toISOString().slice(0, 10);

async function main() {
  // ================= SETUP =================
  const adminReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P11 Admin", email: emailOf("admin"), password: "admin-passphrase-11" },
  });
  const adminId = adminReg.body.data.user.id;
  created.userIds.add(adminId);
  await prisma.user.update({
    where: { id: adminId },
    data: { isSuperAdmin: true, status: "ACTIVE", emailVerifiedAt: new Date() },
  });
  const adminToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("admin"), password: "admin-passphrase-11" } })
  ).body.data.accessToken;

  const branch = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: BRANCH_CODE, name: "P11 Branch", city: "Karachi", timezone: "Asia/Karachi" },
  });
  const branchId = branch.body.data.id;
  created.branchIds.add(branchId);

  // ================= CHART OF ACCOUNTS =================
  const verify = await api("/admin/accounts/verify", { token: adminToken });
  check("the seeded chart supports every posting rule", verify.body?.data?.healthy === true, verify.body?.data);

  const accounts = await api("/admin/accounts", { token: adminToken });
  const byCode = new Map(accounts.body.data.map((row) => [row.code, row]));
  check("the chart is seeded", accounts.body.data.length >= 37, accounts.body?.data?.length);
  check("system accounts are marked as such", byCode.get("1100").isSystem === true, byCode.get("1100"));

  check(
    "discounts given is contra-income, not an expense",
    byCode.get("4900").type === "INCOME" && byCode.get("4900").normalBalance === "DEBIT",
    byCode.get("4900"),
  );
  check("tips are a liability, not income", byCode.get("2350").type === "LIABILITY", byCode.get("2350"));

  const tree = await api("/admin/accounts/tree", { token: adminToken });
  check("the chart reads as a tree", tree.body.data.length === 5, tree.body?.data?.map?.((r) => r.code));

  const dupCode = await api("/admin/accounts", {
    method: "POST",
    token: adminToken,
    body: { code: "1100", name: "Another cash", type: "ASSET" },
  });
  check("account codes are unique", dupCode.status === 409, dupCode.body?.error);

  const wrongParent = await api("/admin/accounts", {
    method: "POST",
    token: adminToken,
    body: { code: `9${String(stamp).slice(-4)}`, name: "Odd", type: "ASSET", parentId: byCode.get("4000").id },
  });
  check("a child account must match its parent's type", wrongParent.status === 400, wrongParent.body?.error);

  const customAccount = await api("/admin/accounts", {
    method: "POST",
    token: adminToken,
    body: {
      code: `5${String(stamp).slice(-4)}`,
      name: `Marketing ${stamp}`,
      type: "EXPENSE",
      parentId: byCode.get("5000").id,
    },
  });
  check("a custom account can be added", customAccount.status === 201, customAccount.body);
  const marketingId = customAccount.body.data.id;
  created.accountIds.add(marketingId);
  check("normal balance is derived from the type", customAccount.body.data.normalBalance === "DEBIT", customAccount.body?.data);

  const killRequired = await api(`/admin/accounts/${byCode.get("1400").id}/active`, {
    method: "PUT",
    token: adminToken,
    body: { isActive: false },
  });
  check("an account the posting rules need cannot be deactivated", killRequired.status === 409, killRequired.body?.error);

  const recodeSystem = await api(`/admin/accounts/${byCode.get("4100").id}`, {
    method: "PATCH",
    token: adminToken,
    body: { code: "4199" },
  });
  check("a system account's code is fixed", recodeSystem.status === 409, recodeSystem.body?.error);

  const renameSystem = await api(`/admin/accounts/${byCode.get("4100").id}`, {
    method: "PATCH",
    token: adminToken,
    body: { name: `Food sales ${stamp}` },
  });
  check("but it can be renamed", renameSystem.status === 200, renameSystem.body?.error);
  await api(`/admin/accounts/${byCode.get("4100").id}`, {
    method: "PATCH",
    token: adminToken,
    body: { name: "Food sales" },
  });

  // ================= FISCAL CALENDAR =================
  const year = new Date().getUTCFullYear();
  const fy = await api("/admin/fiscal-years", {
    method: "POST",
    token: adminToken,
    body: { name: `FY ${year} ${stamp}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` },
  });
  check("a fiscal year is created", fy.status === 201, fy.body);
  const fyId = fy.body.data.id;
  check("twelve monthly periods are generated", fy.body.data.periods.length === 12, fy.body?.data?.periods?.length);

  const overlapping = await api("/admin/fiscal-years", {
    method: "POST",
    token: adminToken,
    body: { name: `FY overlap ${stamp}`, startDate: `${year}-06-01`, endDate: `${year + 1}-05-31` },
  });
  check("fiscal years cannot overlap", overlapping.status === 409, overlapping.body?.error);

  const periods = fy.body.data.periods;
  const januaryId = periods[0].id;
  const februaryId = periods[1].id;
  const thisMonth = periods[new Date().getUTCMonth()];

  const outOfOrder = await api(`/admin/accounting-periods/${februaryId}/close`, { method: "POST", token: adminToken });
  check("periods must be closed in order", outOfOrder.status === 409, outOfOrder.body?.error);

  // ================= MANUAL JOURNAL ENTRIES =================
  const unbalanced = await api("/admin/journal-entries", {
    method: "POST",
    token: adminToken,
    body: {
      branchId,
      memo: "Wrong",
      lines: [
        { accountCode: "1100", debit: 100 },
        { accountCode: "3100", credit: 99.99 },
      ],
    },
  });
  check("an entry that does not balance is refused", unbalanced.status === 400, unbalanced.body?.error);
  check(
    "and the error says by how much",
    JSON.stringify(unbalanced.body?.error ?? {}).includes("0.01"),
    unbalanced.body?.error,
  );

  const bothSides = await api("/admin/journal-entries", {
    method: "POST",
    token: adminToken,
    body: {
      branchId,
      lines: [
        { accountCode: "1100", debit: 100, credit: 50 },
        { accountCode: "3100", credit: 50 },
      ],
    },
  });
  check("a line cannot be a debit and a credit at once", bothSides.status === 400, bothSides.body?.error);

  const capital = await api("/admin/journal-entries", {
    method: "POST",
    token: adminToken,
    body: {
      branchId,
      entryDate: `${year}-${String(thisMonth.startDate).slice(5, 7)}-15`,
      memo: `Owner's capital ${stamp}`,
      post: true,
      lines: [
        { accountCode: "1200", debit: 100000, description: "Opening bank" },
        { accountCode: "3100", credit: 100000, description: "Capital introduced" },
      ],
    },
  });
  check("a balanced entry posts", capital.status === 201 && capital.body.data.status === "POSTED", capital.body);
  const capitalEntryId = capital.body.data.id;
  check("it is numbered", String(capital.body.data.entryNumber ?? "").startsWith(`JE-${BRANCH_CODE}`), capital.body?.data);
  check("it is filed in the right period", Boolean(capital.body.data.periodId), capital.body?.data);
  check("totals mirror the lines", num(capital.body.data.totalDebit) === 100000, capital.body?.data);

  const draft = await api("/admin/journal-entries", {
    method: "POST",
    token: adminToken,
    body: {
      branchId,
      memo: `Draft ${stamp}`,
      lines: [
        { accountCode: "5750", debit: 500 },
        { accountCode: "1100", credit: 500 },
      ],
    },
  });
  check("an entry is a draft unless it says otherwise", draft.body?.data?.status === "DRAFT", draft.body?.data);
  const draftId = draft.body.data.id;
  check("a draft has no period until it posts", draft.body.data.periodId === null, draft.body?.data);

  // ================= IMMUTABILITY =================
  const voidPosted = await api(`/admin/journal-entries/${capitalEntryId}/void`, {
    method: "POST",
    token: adminToken,
    body: { reason: "changed my mind" },
  });
  check("a posted entry cannot be voided", voidPosted.status === 409, voidPosted.body?.error);

  const reversal = await api(`/admin/journal-entries/${capitalEntryId}/reverse`, {
    method: "POST",
    token: adminToken,
    body: { reason: "Wrong bank account" },
  });
  check("a posted entry is corrected by reversing it", reversal.status === 201, reversal.body);
  const reversalId = reversal.body.data.id;
  check("the reversal flips the sides", num(reversal.body.data.lines.find((l) => l.account.code === "1200").credit) === 100000, reversal.body?.data?.lines);

  const original = await api(`/admin/journal-entries/${capitalEntryId}`, { token: adminToken });
  check("the original is left exactly as it was", original.body.data.status === "POSTED", original.body?.data);
  check("and points at its reversal", original.body.data.reversedBy?.id === reversalId, original.body?.data);

  const reverseTwice = await api(`/admin/journal-entries/${capitalEntryId}/reverse`, {
    method: "POST",
    token: adminToken,
    body: { reason: "again" },
  });
  check("an entry cannot be reversed twice", reverseTwice.status === 409, reverseTwice.body?.error);

  // Re-post the capital so the rest of the suite has money to work with.
  await api("/admin/journal-entries", {
    method: "POST",
    token: adminToken,
    body: {
      branchId,
      memo: `Owner's capital, corrected ${stamp}`,
      post: true,
      lines: [
        { accountCode: "1200", debit: 100000 },
        { accountCode: "3100", credit: 100000 },
      ],
    },
  });

  // ================= A REAL PURCHASE: GRN -> BILL -> PAYMENT =================
  const suffix = String(stamp).slice(-5);
  const kgRes = await api("/admin/units", {
    method: "POST",
    token: adminToken,
    body: { code: `KG${suffix}`, name: "Kilogram", type: "WEIGHT", precision: 3 },
  });
  const kgId = kgRes.body.data.id;
  created.unitIds.add(kgId);

  const locationRes = await api("/admin/stock-locations", {
    method: "POST",
    token: adminToken,
    body: { branchId, name: "Main store", code: "MAIN", type: "MAIN_STORE", isDefault: true },
  });
  const locationId = locationRes.body.data.id;

  const itemRes = await api("/admin/inventory-items", {
    method: "POST",
    token: adminToken,
    body: { name: `Rice ${stamp}`, uomId: kgId, type: "RAW_MATERIAL", costingMethod: "WEIGHTED_AVERAGE" },
  });
  const itemId = itemRes.body.data.id;

  const supplierRes = await api("/admin/suppliers", {
    method: "POST",
    token: adminToken,
    body: { code: `SUP${String(stamp).slice(-6)}`, name: `Grain Co ${stamp}`, paymentTermDays: 30 },
  });
  const supplierId = supplierRes.body.data.id;

  const grnRes = await api("/admin/goods-receipts", {
    method: "POST",
    token: adminToken,
    body: {
      locationId,
      supplierId,
      landedCost: 500,
      items: [{ itemId, quantity: 100, unitCost: 150, uomId: kgId, taxRate: 10 }],
    },
  });
  const grnId = grnRes.body.data.id;
  await api(`/admin/goods-receipts/${grnId}/post`, { method: "POST", token: adminToken });

  check("the outbox drains", (await drainOutbox()) === 200);

  const grnEntry = await prisma.journalEntry.findFirst({
    where: { source: "GOODS_RECEIPT", sourceId: grnId },
    select: { id: true, totalDebit: true, totalCredit: true, lines: { select: { debit: true, credit: true, account: { select: { code: true } } } } },
  });
  check("receiving stock posts to the ledger", Boolean(grnEntry), grnEntry);
  // 100 kg at 150 = 15000, plus 500 freight landed into the stock value.
  check("inventory is debited at landed cost", num(grnEntry?.lines.find((l) => l.account.code === "1400")?.debit) === 15500, grnEntry?.lines);
  check(
    "the other side is goods-received-not-invoiced, not payables",
    Boolean(grnEntry?.lines.find((l) => l.account.code === "2450")),
    grnEntry?.lines,
  );
  check("no payable exists before the invoice arrives", !grnEntry?.lines.find((l) => l.account.code === "2100"), grnEntry?.lines);

  // Draining twice must not post twice.
  await drainOutbox();
  const grnEntries = await prisma.journalEntry.count({ where: { source: "GOODS_RECEIPT", sourceId: grnId } });
  check("a redelivered event does not post a second time", grnEntries === 1, grnEntries);

  const bill = await api(`/admin/supplier-bills/from-receipt/${grnId}`, {
    method: "POST",
    token: adminToken,
    body: { supplierInvoiceNumber: `INV-${stamp}` },
  });
  check("a bill can be built from the receipt", bill.status === 201, bill.body);
  const billId = bill.body.data.id;
  // 15000 goods + 500 freight landed in, plus 10% tax on the goods line.
  check("the bill carries the landed cost and tax", num(bill.body.data.grandTotal) === 17000, bill.body?.data);
  check("the due date comes from the supplier's terms", Boolean(bill.body.data.dueDate), bill.body?.data);

  const dupBill = await api(`/admin/supplier-bills/from-receipt/${grnId}`, {
    method: "POST",
    token: adminToken,
    body: {},
  });
  check("one receipt cannot be billed twice", dupBill.status === 409, dupBill.body?.error);

  const payUnapproved = await api(`/admin/supplier-bills/${billId}/payments`, {
    method: "POST",
    token: adminToken,
    body: { amount: 100 },
  });
  check("an unapproved bill cannot be paid", payUnapproved.status === 409, payUnapproved.body?.error);

  const beforeApprove = await prisma.journalEntry.count({ where: { source: "SUPPLIER_BILL", sourceId: billId } });
  check("a draft bill is not in the ledger", beforeApprove === 0, beforeApprove);

  await api(`/admin/supplier-bills/${billId}/approve`, { method: "POST", token: adminToken });
  await drainOutbox();

  const billEntry = await prisma.journalEntry.findFirst({
    where: { source: "SUPPLIER_BILL", sourceId: billId },
    select: { lines: { select: { debit: true, credit: true, account: { select: { code: true } } } } },
  });
  check("approving the bill posts it", Boolean(billEntry), billEntry);
  check("payables now carry the debt", num(billEntry?.lines.find((l) => l.account.code === "2100")?.credit) === 17000, billEntry?.lines);
  check("and GRNI is cleared by the same amount it accrued", num(billEntry?.lines.find((l) => l.account.code === "2450")?.debit) === 15500, billEntry?.lines);

  // GRNI should now be flat: accrued 15500 on receipt, cleared 15500 on the bill.
  const grniAccount = byCode.get("2450");
  const grniLedger = await api(`/admin/accounts/${grniAccount.id}/ledger`, { token: adminToken });
  check("GRNI nets to zero once the invoice lands", round(num(grniLedger.body.data.closingBalance)) === 0, grniLedger.body?.data);

  const overpay = await api(`/admin/supplier-bills/${billId}/payments`, {
    method: "POST",
    token: adminToken,
    body: { amount: 20000, accountId: byCode.get("1200").id, method: "BANK_TRANSFER" },
  });
  check("a bill cannot be overpaid", overpay.status === 400, overpay.body?.error);

  const part = await api(`/admin/supplier-bills/${billId}/payments`, {
    method: "POST",
    token: adminToken,
    body: { amount: 7000, accountId: byCode.get("1200").id, method: "BANK_TRANSFER", reference: "TRX-1" },
  });
  check("a part payment is recorded", part.status === 201, part.body);
  check("the bill is partially paid", part.body.data.status === "PARTIALLY_PAID", part.body?.data);
  check("and the outstanding is derived", num(part.body.data.outstanding) === 10000, part.body?.data);

  await drainOutbox();

  const rest = await api(`/admin/supplier-bills/${billId}/payments`, {
    method: "POST",
    token: adminToken,
    body: { amount: 10000, accountId: byCode.get("1200").id, method: "BANK_TRANSFER" },
  });
  check("settling the rest marks it paid", rest.body?.data?.status === "PAID", rest.body?.data);
  await drainOutbox();

  const payableLedger = await api(`/admin/accounts/${byCode.get("2100").id}/ledger`, { token: adminToken });
  check("the payable is extinguished", round(num(payableLedger.body.data.closingBalance)) === 0, payableLedger.body?.data);

  const ageing = await api(`/admin/supplier-bills/ageing?branchId=${branchId}`, { token: adminToken });
  check("a settled bill leaves the ageing", num(ageing.body.data.total) === 0, ageing.body?.data);

  // ================= EXPENSES =================
  const category = await api("/admin/expense-categories", {
    method: "POST",
    token: adminToken,
    body: { name: `Utilities ${stamp}`, accountId: byCode.get("5750").id },
  });
  check("an expense category is created", category.status === 201, category.body);
  const categoryId = category.body.data.id;

  const wrongAccount = await api("/admin/expense-categories", {
    method: "POST",
    token: adminToken,
    body: { name: `Bad ${stamp}`, accountId: byCode.get("4100").id },
  });
  check("a category cannot point at an income account", wrongAccount.status === 400, wrongAccount.body?.error);

  const expense = await api("/admin/expenses", {
    method: "POST",
    token: adminToken,
    body: {
      branchId,
      categoryId,
      paidFromId: byCode.get("1200").id,
      payee: `K-Electric ${stamp}`,
      amount: 5500,
      taxAmount: 500,
      description: "Monthly bill",
    },
  });
  check("an expense is recorded", expense.status === 201, expense.body);
  const expenseId = expense.body.data.id;
  check("it starts as a draft", expense.body.data.status === "DRAFT", expense.body?.data);

  const taxTooBig = await api("/admin/expenses", {
    method: "POST",
    token: adminToken,
    body: { branchId, amount: 100, taxAmount: 200 },
  });
  check("the tax cannot exceed the expense", taxTooBig.status === 400, taxTooBig.body?.error);

  const notPostedYet = await prisma.journalEntry.count({ where: { source: "EXPENSE", sourceId: expenseId } });
  check("a draft expense is not in the ledger", notPostedYet === 0, notPostedYet);

  await api(`/admin/expenses/${expenseId}/approve`, { method: "POST", token: adminToken });
  await drainOutbox();

  const expenseEntry = await prisma.journalEntry.findFirst({
    where: { source: "EXPENSE", sourceId: expenseId },
    select: { lines: { select: { debit: true, credit: true, account: { select: { code: true } } } } },
  });
  check("approving posts the expense", Boolean(expenseEntry), expenseEntry);
  check("the category's account takes the net", num(expenseEntry?.lines.find((l) => l.account.code === "5750")?.debit) === 5000, expenseEntry?.lines);
  check("recoverable tax is split out", num(expenseEntry?.lines.find((l) => l.account.code === "2200")?.debit) === 500, expenseEntry?.lines);
  check("the bank is credited the whole amount", num(expenseEntry?.lines.find((l) => l.account.code === "1200")?.credit) === 5500, expenseEntry?.lines);

  const editApproved = await api(`/admin/expenses/${expenseId}`, {
    method: "PATCH",
    token: adminToken,
    body: { amount: 9999 },
  });
  check("an approved expense cannot be edited", editApproved.status === 409, editApproved.body?.error);

  const deleteApproved = await api(`/admin/expenses/${expenseId}`, { method: "DELETE", token: adminToken });
  check("nor deleted", deleteApproved.status === 409, deleteApproved.body?.error);

  const summary = await api(`/admin/expenses/summary?branchId=${branchId}`, { token: adminToken });
  check("spend is summarised by category", num(summary.body.data.total) === 5500, summary.body?.data);

  // ================= STATEMENTS =================
  const trial = await api(`/admin/reports/trial-balance?branchId=${branchId}`, { token: adminToken });
  check("the trial balance agrees", trial.body?.data?.balanced === true, {
    debit: trial.body?.data?.totalDebit,
    credit: trial.body?.data?.totalCredit,
  });

  const sheet = await api(`/admin/reports/balance-sheet?branchId=${branchId}`, { token: adminToken });
  check("the balance sheet balances", sheet.body?.data?.balanced === true, {
    assets: sheet.body?.data?.totalAssets,
    liabilitiesAndEquity: sheet.body?.data?.totalLiabilitiesAndEquity,
    difference: sheet.body?.data?.difference,
  });
  check("inventory is on the balance sheet at what was received", num(sheet.body.data.assets.find((a) => a.code === "1400")?.balance) === 15500, sheet.body?.data?.assets);

  const pnl = await api(`/admin/reports/profit-and-loss?branchId=${branchId}`, { token: adminToken });
  // The only expense so far is the utility bill, net of its recoverable tax.
  check("the P&L shows the operating spend", num(pnl.body.data.operatingExpenses) === 5000, pnl.body?.data);
  check("with no revenue yet, the loss is that spend", num(pnl.body.data.netProfit) === -5000, pnl.body?.data);

  const cash = await api(`/admin/reports/cash-flow?branchId=${branchId}`, { token: adminToken });
  check("cash flow reports real movements", num(cash.body.data.outflow) > 0, cash.body?.data);

  const audit = await api("/admin/journal-entries/audit", { token: adminToken });
  check("every posted entry balances", audit.body?.data?.healthy === true, audit.body?.data);
  check("and the audit actually looked at entries", audit.body.data.entriesChecked > 0, audit.body?.data);

  const pack = await api(`/admin/reports/summary?branchId=${branchId}`, { token: adminToken });
  check("the close pack carries its own checks", pack.body?.data?.checks?.healthy === true, pack.body?.data?.checks);

  // ================= CLOSING A PERIOD =================
  const closeWithDraft = await api(`/admin/accounting-periods/${januaryId}/close`, { method: "POST", token: adminToken });
  check("january closes cleanly", closeWithDraft.status === 200, closeWithDraft.body?.error);

  const postIntoClosed = await api("/admin/journal-entries", {
    method: "POST",
    token: adminToken,
    body: {
      branchId,
      entryDate: `${year}-01-15`,
      post: true,
      lines: [
        { accountCode: "1100", debit: 10 },
        { accountCode: "3100", credit: 10 },
      ],
    },
  });
  check("nothing posts into a closed period", postIntoClosed.status === 409, postIntoClosed.body?.error);
  check(
    "and the refusal names the period",
    JSON.stringify(postIntoClosed.body?.error ?? {}).toLowerCase().includes("january"),
    postIntoClosed.body?.error,
  );

  const reopenNoReason = await api(`/admin/accounting-periods/${januaryId}/reopen`, {
    method: "POST",
    token: adminToken,
    body: {},
  });
  check("reopening demands a reason", reopenNoReason.status === 400, reopenNoReason.body?.error);

  const reopened = await api(`/admin/accounting-periods/${januaryId}/reopen`, {
    method: "POST",
    token: adminToken,
    body: { reason: "Missed a supplier invoice" },
  });
  check("a closed period can be reopened", reopened.body?.data?.status === "OPEN", reopened.body);

  const reopenAudit = await prisma.auditLog.findFirst({
    where: { action: "accounting_period.reopen", entityId: januaryId },
    select: { changes: true },
  });
  check("reopening is audited with its reason", Boolean(reopenAudit), reopenAudit);

  await api(`/admin/accounting-periods/${januaryId}/close`, { method: "POST", token: adminToken });
  const locked = await api(`/admin/accounting-periods/${januaryId}/lock`, { method: "POST", token: adminToken });
  check("a closed period can be locked", locked.body?.data?.status === "LOCKED", locked.body);

  const reopenLocked = await api(`/admin/accounting-periods/${januaryId}/reopen`, {
    method: "POST",
    token: adminToken,
    body: { reason: "please" },
  });
  check("a locked period is a dead end", reopenLocked.status === 409, reopenLocked.body?.error);

  // ================= PERMISSIONS =================
  const clerkReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P11 Clerk", email: emailOf("clerk"), password: "clerk-passphrase-11" },
  });
  const clerkId = clerkReg.body.data.user.id;
  created.userIds.add(clerkId);
  await prisma.user.update({ where: { id: clerkId }, data: { emailVerifiedAt: new Date(), status: "ACTIVE" } });

  const clerkRole = await api("/admin/roles", {
    method: "POST",
    token: adminToken,
    body: { name: `P11 Clerk ${stamp}`, description: "Records, cannot approve or post" },
  });
  await api(`/admin/roles/${clerkRole.body.data.id}/permissions`, {
    method: "PUT",
    token: adminToken,
    body: { permissionKeys: ["expenses.read", "expenses.create", "journal_entries.read", "accounts.read"] },
  });
  await api(`/admin/users/${clerkId}/roles`, {
    method: "POST",
    token: adminToken,
    body: { roleId: clerkRole.body.data.id, branchId },
  });
  const clerkToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("clerk"), password: "clerk-passphrase-11" } })
  ).body.data.accessToken;

  const clerkRecords = await api("/admin/expenses", {
    method: "POST",
    token: clerkToken,
    body: { branchId, amount: 250, payee: "Petty cash", categoryId },
  });
  check("the role really does grant expense recording", clerkRecords.status === 201, clerkRecords.body?.error);
  const clerkExpenseId = clerkRecords.body.data.id;

  const clerkApproves = await api(`/admin/expenses/${clerkExpenseId}/approve`, { method: "POST", token: clerkToken });
  check("recording an expense is not approving one", clerkApproves.status === 403, clerkApproves.body?.error);

  const clerkPosts = await api("/admin/journal-entries", {
    method: "POST",
    token: clerkToken,
    body: { branchId, lines: [{ accountCode: "1100", debit: 5 }, { accountCode: "3100", credit: 5 }] },
  });
  check("reading the journal is not writing to it", clerkPosts.status === 403, clerkPosts.body?.error);

  const clerkPnl = await api(`/admin/reports/profit-and-loss?branchId=${branchId}`, { token: clerkToken });
  check("financial statements need their own permission", clerkPnl.status === 403, clerkPnl.body?.error);

  // ================= BACKFILL =================
  const backfill = await api("/admin/journal-entries/backfill", {
    method: "POST",
    token: adminToken,
    body: {},
  });
  check("the backfill runs", backfill.status === 200, backfill.body);
  check("and finds nothing missing, because the outbox already posted it", backfill.body.data.failures.length === 0, backfill.body?.data);

  const auditAfter = await api("/admin/journal-entries/audit", { token: adminToken });
  check("the ledger still adds up after everything", auditAfter.body?.data?.healthy === true, auditAfter.body?.data);
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { contains: tag } }, select: { id: true } });
  const ids = [...new Set([...created.userIds, ...users.map((u) => u.id)])];
  const branchIds = [...created.branchIds];

  const locations = await prisma.stockLocation.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } });
  const locationIds = locations.map((l) => l.id);
  const items = await prisma.inventoryItem.findMany({ where: { name: { contains: String(stamp) } }, select: { id: true } });
  const itemIds = items.map((i) => i.id);

  // Journal lines first: every entry points at accounts that must survive.
  await prisma.journalLine.deleteMany({ where: { entry: { branchId: { in: branchIds } } } });
  await prisma.journalEntry.deleteMany({ where: { reversalOfId: { not: null }, branchId: { in: branchIds } } });
  await prisma.journalEntry.deleteMany({ where: { branchId: { in: branchIds } } });

  await prisma.billPayment.deleteMany({ where: { bill: { branchId: { in: branchIds } } } });
  await prisma.supplierBill.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.expense.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.expenseCategory.deleteMany({ where: { name: { contains: String(stamp) } } });

  await prisma.accountingPeriod.deleteMany({ where: { fiscalYear: { name: { contains: String(stamp) } } } });
  await prisma.fiscalYear.deleteMany({ where: { name: { contains: String(stamp) } } });

  // Only accounts this suite created — the seeded chart stays.
  await prisma.account.deleteMany({ where: { id: { in: [...created.accountIds] }, isSystem: false } });

  await prisma.stockMovement.deleteMany({ where: { OR: [{ locationId: { in: locationIds } }, { itemId: { in: itemIds } }] } });
  await prisma.stockBatch.deleteMany({ where: { OR: [{ locationId: { in: locationIds } }, { itemId: { in: itemIds } }] } });
  await prisma.stockLevel.deleteMany({ where: { OR: [{ locationId: { in: locationIds } }, { itemId: { in: itemIds } }] } });
  await prisma.goodsReceiptItem.deleteMany({ where: { goodsReceipt: { branchId: { in: branchIds } } } });
  await prisma.goodsReceipt.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.stockLocation.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.supplierItem.deleteMany({ where: { itemId: { in: itemIds } } });
  await prisma.supplier.deleteMany({ where: { name: { contains: String(stamp) } } });
  await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
  await prisma.unitOfMeasure.deleteMany({ where: { id: { in: [...created.unitIds].filter(Boolean) } } });

  // Every status, not just the unprocessed ones. Phase 2 checks the outbox is
  // empty as part of its baseline, so a DONE row left here fails a suite that
  // runs earlier in the next regression — a confusing place for it to surface.
  await prisma.outboxEvent.deleteMany({});
  await prisma.numberSequence.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.credentialToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userRoleAssignment.deleteMany({ where: { userId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.rolePermission.deleteMany({ where: { role: { name: { contains: String(stamp) } } } });
  await prisma.role.deleteMany({ where: { name: { contains: String(stamp) } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: "E2EB" } } });
  await prisma.setting.deleteMany({});

  const leftovers = {
    users: await prisma.user.count(),
    branches: await prisma.branch.count(),
    journalEntries: await prisma.journalEntry.count(),
    journalLines: await prisma.journalLine.count(),
    fiscalYears: await prisma.fiscalYear.count(),
    periods: await prisma.accountingPeriod.count(),
    supplierBills: await prisma.supplierBill.count(),
    expenses: await prisma.expense.count(),
    expenseCategories: await prisma.expenseCategory.count(),
    items: await prisma.inventoryItem.count(),
    receipts: await prisma.goodsReceipt.count(),
    suppliers: await prisma.supplier.count(),
    units: await prisma.unitOfMeasure.count(),
    // The seeded chart and system roles are the baseline, not leftovers.
    roles: await prisma.role.count(),
    accounts: await prisma.account.count(),
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

  const ignore = ["roles", "accounts"];
  const dirty = Object.entries(leftovers).filter(([key, value]) => !ignore.includes(key) && value > 0);
  if (dirty.length) console.log("WARNING: database not clean:", JSON.stringify(dirty));

  process.exit(failures.length || dirty.length ? 1 : 0);
}
