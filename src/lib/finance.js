import { add, addAmounts, decimal, difference, exceeds, minusAmounts, percentOf, sameAmount, unscale } from "@/lib/money-math";

export { addAmounts, difference, exceeds, minusAmounts, sameAmount };

/**
 * The money screens' vocabulary and arithmetic, with no React and no database
 * in it, so every rule below can be tested directly.
 *
 * Finance is the one part of this system where a plausible-looking wrong
 * number is worse than a visible error. A delivery board that lags by ten
 * seconds costs nobody anything; a till that says the drawer agrees when it is
 * two hundred short means the shortage is never looked for. So the helpers
 * here lean towards saying "this does not add up" loudly, and towards naming
 * what a figure *is* rather than what it is nearly.
 *
 * All the arithmetic goes through `money-math`, on digit strings, never
 * floats. The server is authoritative; this only has to agree with it.
 */

const CHIP = {
  good: "bg-success-container text-on-success-container",
  warn: "bg-warning-container text-on-warning-container",
  bad: "bg-error-container text-on-error-container",
  live: "bg-secondary-container text-on-secondary-container",
  quiet: "bg-surface-container-high text-on-surface-variant",
};

// --- payments ---------------------------------------------------------------

/**
 * What each payment state means in a sentence a cashier would use.
 *
 * `AUTHORIZED` is the one worth spelling out: the money is reserved and has
 * not arrived, and an authorisation that is never captured quietly expires. A
 * chip reading "authorised" looks like success, which is why the description
 * says otherwise.
 */
export const PAYMENT_STATES = {
  PENDING: { label: "Pending", tone: CHIP.quiet, note: "Started, not yet paid." },
  AUTHORIZED: { label: "Authorised", tone: CHIP.warn, note: "Reserved on the card but not taken. Capture it or it expires." },
  CAPTURED: { label: "Paid", tone: CHIP.good, note: "The money has been taken." },
  FAILED: { label: "Failed", tone: CHIP.bad, note: "The attempt did not go through." },
  CANCELLED: { label: "Cancelled", tone: CHIP.quiet, note: "Abandoned before any money moved." },
  EXPIRED: { label: "Expired", tone: CHIP.bad, note: "The authorisation lapsed before it was captured." },
  REFUNDED: { label: "Refunded", tone: CHIP.quiet, note: "Paid, then given back in full." },
  PARTIALLY_REFUNDED: { label: "Part refunded", tone: CHIP.warn, note: "Some of it has been given back." },
};

export const PAYMENT_METHODS = {
  CASH: "Cash",
  CASH_ON_DELIVERY: "Cash on delivery",
  CARD: "Card",
  UPI: "UPI",
  NET_BANKING: "Bank",
  WALLET: "Wallet",
  BANK_TRANSFER: "Transfer",
  GIFT_CARD: "Gift card",
  STORE_CREDIT: "Store credit",
  AGGREGATOR: "Aggregator",
  OTHER: "Other",
};

export const methodLabel = (method) => PAYMENT_METHODS[method] ?? method ?? "—";

/**
 * The gateway worth naming beside the method, if any.
 *
 * Cash is recorded with the provider "cash", so printing both read "Cash ·
 * cash" on every counter payment — a stutter that says nothing. A provider is
 * only interesting when it is somewhere the money actually went, so one that
 * merely restates the method is dropped.
 */
export function providerNote(method, provider) {
  if (!provider) return null;
  const restates = provider.replace(/[\s_-]/g, "").toLowerCase() === String(method ?? "").replace(/[\s_-]/g, "").toLowerCase();
  return restates ? null : provider;
}

/** The tabs over the payments list. */
export const PAYMENT_FILTERS = [
  { value: "", label: "All" },
  { value: "PENDING", label: "Pending" },
  { value: "AUTHORIZED", label: "To capture" },
  { value: "CAPTURED", label: "Paid" },
  { value: "FAILED", label: "Failed" },
];

/** Physical money, which behaves differently from a card and is counted by hand. */
export const isCash = (method) => method === "CASH" || method === "CASH_ON_DELIVERY";

/**
 * Which buttons a payment should offer.
 *
 * Driven by the state rather than shown-and-disabled: a row of greyed-out
 * buttons invites a click and then explains why it was refused, which is a
 * worse way to say "not now" than simply not offering it.
 */
export function paymentActions(payment) {
  if (!payment) return [];
  const actions = [];

  if (payment.status === "AUTHORIZED") {
    actions.push({ key: "capture", label: "Capture", intent: "primary" });
  }
  if (payment.status === "PENDING" && isCash(payment.method)) {
    actions.push({ key: "collect", label: "Mark collected", intent: "primary" });
  }
  if (payment.status === "PENDING" || payment.status === "AUTHORIZED") {
    actions.push({ key: "void", label: "Void", intent: "danger" });
  }
  return actions;
}

/** What is still refundable: captured, less whatever has already gone back. */
export function refundableAmount(payment) {
  if (!payment || payment.status === "FAILED" || payment.status === "CANCELLED" || payment.status === "EXPIRED") {
    return "0.00";
  }
  if (payment.status === "PENDING" || payment.status === "AUTHORIZED") return "0.00";
  return difference(payment.amount, payment.refundedAmount ?? 0);
}

// --- refunds ----------------------------------------------------------------

export const REFUND_STATES = {
  REQUESTED: { label: "Requested", tone: CHIP.warn, note: "Waiting for someone to approve it." },
  APPROVED: { label: "Approved", tone: CHIP.live, note: "Approved and on its way to the provider." },
  PROCESSING: { label: "Processing", tone: CHIP.live, note: "With the provider." },
  COMPLETED: { label: "Refunded", tone: CHIP.good, note: "The money has gone back." },
  FAILED: { label: "Failed", tone: CHIP.bad, note: "The provider refused it. The customer has not been paid." },
  REJECTED: { label: "Rejected", tone: CHIP.quiet, note: "Turned down. No money moved." },
};

export const REFUND_FILTERS = [
  { value: "", label: "All" },
  { value: "REQUESTED", label: "To approve" },
  { value: "PROCESSING", label: "In flight" },
  { value: "COMPLETED", label: "Done" },
  { value: "FAILED", label: "Failed" },
];

/** A refund only awaits a decision while it is still a request. */
export const awaitingDecision = (refund) => refund?.status === "REQUESTED";

/**
 * A failed refund is the one state that needs chasing.
 *
 * The customer has been told they are getting their money and the provider
 * has refused; nothing in the system will retry on its own. Left in a list
 * among the completed ones it looks finished.
 */
export const needsChasing = (refund) => refund?.status === "FAILED";

// --- cash registers ---------------------------------------------------------

export const SESSION_STATES = {
  OPEN: { label: "Open", tone: CHIP.live, note: "A shift is running against this drawer." },
  CLOSED: { label: "Closed", tone: CHIP.warn, note: "Counted, not yet signed off." },
  RECONCILED: { label: "Reconciled", tone: CHIP.good, note: "Counted and signed off." },
};

export const MOVEMENT_TYPES = {
  SALE: { label: "Sale", direction: "in" },
  REFUND: { label: "Refund", direction: "out" },
  PAY_IN: { label: "Paid in", direction: "in" },
  PAY_OUT: { label: "Paid out", direction: "out" },
  DROP: { label: "Moved to safe", direction: "out" },
  TIP_OUT: { label: "Tips out", direction: "out" },
  ADJUSTMENT: { label: "Adjustment", direction: "either" },
};

/** Movement kinds a human records by hand. Sales and refunds arrive on their own. */
export const MANUAL_MOVEMENTS = ["PAY_IN", "PAY_OUT", "DROP", "TIP_OUT", "ADJUSTMENT"];

/**
 * How a counted drawer compares with what the system expected.
 *
 * Over and short are named separately and never averaged into one "variance"
 * figure, because they are different problems: short is usually a missing
 * payment or a theft, over is usually a sale that was never rung up. A signed
 * number in a column makes them look like two ends of one scale.
 */
export function cashVariance({ expected, counted }) {
  if (counted === null || counted === undefined || counted === "") {
    return { known: false, label: "Not counted yet", tone: "text-on-surface-variant", amount: "0.00", direction: "none" };
  }

  const delta = minusAmounts(counted, expected ?? 0);
  if (sameAmount(delta, "0")) {
    return { known: true, label: "Agrees exactly", tone: "text-on-surface", amount: "0.00", direction: "square" };
  }

  const over = !String(delta).startsWith("-");
  return {
    known: true,
    // The absolute size, with the direction carried in words rather than a
    // minus sign that is easy to miss on a printed close sheet.
    amount: over ? delta : String(delta).slice(1),
    direction: over ? "over" : "short",
    label: over ? "Over" : "Short",
    tone: over ? "text-warning" : "text-error",
  };
}

/**
 * What the drawer should hold: the float, plus everything that moved through it.
 *
 * Mirrors the server's own sum so the close screen can show a cashier the
 * figure before they count, rather than after they have committed to one.
 */
export function expectedCash({ openingFloat = 0, movements = [] }) {
  return movements.reduce((total, movement) => addAmounts(total, movement.amount ?? 0), unscale(decimal(openingFloat)));
}

// --- expenses ---------------------------------------------------------------

export const EXPENSE_STATES = {
  DRAFT: { label: "Draft", tone: CHIP.quiet, note: "Not submitted. Nothing is in the ledger." },
  PENDING_APPROVAL: { label: "To approve", tone: CHIP.warn, note: "Waiting for a decision." },
  APPROVED: { label: "Approved", tone: CHIP.good, note: "In the ledger as a cost." },
  REJECTED: { label: "Rejected", tone: CHIP.bad, note: "Turned down." },
  COMPLETED: { label: "Completed", tone: CHIP.good, note: "Settled." },
  CANCELLED: { label: "Cancelled", tone: CHIP.quiet, note: "Withdrawn." },
};

export const EXPENSE_FILTERS = [
  { value: "", label: "All" },
  { value: "DRAFT", label: "Drafts" },
  { value: "PENDING_APPROVAL", label: "To approve" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
];

/** An approved expense is in the books; it is reversed, never edited away. */
export const expenseIsLocked = (expense) => expense?.status === "APPROVED" || expense?.status === "COMPLETED";

/**
 * What actually left the bank — which is `amount`, on its own.
 *
 * `taxAmount` is the part of that total which is tax, **not** an addition to
 * it: the posting rule books `amount - taxAmount` as the cost and the
 * remainder as recoverable input tax. Reading the two as net-plus-tax
 * overstates every receipt by its own tax, and makes anyone typing a net
 * figure into the form post a cost short by that much.
 */
export const expenseTotal = (expense) => unscale(decimal(expense?.amount ?? 0));

/** The part that is a cost: the total less the tax inside it. */
export const expenseNet = (expense) => difference(expense?.amount ?? 0, expense?.taxAmount ?? 0);

export function expensePayload(form) {
  // `amount` is the gross off the receipt and `taxAmount` is the slice of it
  // that is tax, matching what the posting rule subtracts.
  const amount = Number(form.amount);
  const tax = form.taxAmount === "" || form.taxAmount == null ? 0 : Number(form.taxAmount);

  return {
    branchId: form.branchId,
    categoryId: form.categoryId || null,
    paidFromId: form.paidFromId || null,
    payee: form.payee?.trim() || null,
    description: form.description?.trim() || null,
    amount,
    taxAmount: tax,
    expenseDate: form.expenseDate,
    ...(form.receiptUrl ? { receiptUrl: form.receiptUrl } : {}),
  };
}

// --- the chart of accounts --------------------------------------------------

export const ACCOUNT_TYPES = {
  ASSET: { label: "Assets", note: "What the business owns — cash, stock, equipment." },
  LIABILITY: { label: "Liabilities", note: "What it owes — suppliers, staff, tax." },
  EQUITY: { label: "Equity", note: "What the owners have put in and kept in." },
  INCOME: { label: "Income", note: "What it earns." },
  EXPENSE: { label: "Expenses", note: "What it spends to earn that." },
};

/** The order a chart of accounts is conventionally read in. */
export const ACCOUNT_TYPE_ORDER = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"];

/**
 * Which way a balance is "normal" for an account.
 *
 * Shown in words next to the figure because a credit balance on an asset is
 * not a rounding quirk, it is usually a mistake — an overdrawn till, stock
 * valued below zero — and it should read as one.
 */
export function balanceReads(account, balance) {
  const negative = String(balance ?? "0").startsWith("-");
  if (!negative) return { unusual: false, label: "" };

  return {
    unusual: true,
    label:
      account?.normalBalance === "DEBIT"
        ? "Credit balance on a debit account — usually a sign something posted the wrong way round."
        : "Debit balance on a credit account — usually a sign something posted the wrong way round.",
  };
}

/** A flat list of accounts into the tree the chart is read as. */
export function accountTree(accounts) {
  const byId = new Map(accounts.map((account) => [account.id, { ...account, children: [] }]));
  const roots = [];

  for (const account of byId.values()) {
    const parent = account.parentId ? byId.get(account.parentId) : null;
    if (parent) parent.children.push(account);
    else roots.push(account);
  }

  const sort = (rows) => {
    rows.sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
    for (const row of rows) sort(row.children);
    return rows;
  };

  return sort(roots);
}

/** Depth-first, carrying the indent level, for rendering a tree as rows. */
export function flattenAccounts(tree, depth = 0) {
  return tree.flatMap((node) => [{ ...node, depth }, ...flattenAccounts(node.children ?? [], depth + 1)]);
}

export function accountPayload(form) {
  return {
    code: form.code?.trim(),
    name: form.name?.trim(),
    type: form.type,
    subType: form.subType?.trim() || null,
    normalBalance: form.normalBalance,
    parentId: form.parentId || null,
    branchId: form.branchId || null,
    description: form.description?.trim() || null,
  };
}

/** The side a new account's balance normally sits on, from its type. */
export const defaultNormalBalance = (type) => (type === "ASSET" || type === "EXPENSE" ? "DEBIT" : "CREDIT");

// --- the journal ------------------------------------------------------------

export const JOURNAL_STATES = {
  DRAFT: { label: "Draft", tone: CHIP.quiet, note: "Not in the books yet. No report counts it." },
  POSTED: { label: "Posted", tone: CHIP.good, note: "In the books. It can be reversed, never edited." },
  VOID: { label: "Void", tone: CHIP.bad, note: "Discarded before it was posted." },
};

/**
 * Where an entry came from.
 *
 * Almost every entry is written by the system as a side effect of something
 * real, and saying which thing is most of what makes a ledger readable:
 * "4,210 Dr Inventory" means nothing, "from the delivery GRN-0031" means
 * everything.
 */
export const JOURNAL_SOURCES = {
  ORDER: "Order",
  PAYMENT: "Payment",
  REFUND: "Refund",
  GOODS_RECEIPT: "Goods receipt",
  SUPPLIER_BILL: "Supplier bill",
  BILL_PAYMENT: "Bill payment",
  PRODUCTION: "Production",
  STOCK_ADJUSTMENT: "Stock adjustment",
  WASTAGE: "Wastage",
  PAYROLL: "Payroll",
  DRIVER_PAYOUT: "Driver payout",
  EXPENSE: "Expense",
  CASH_SESSION: "Cash session",
  MANUAL: "Manual",
  OPENING_BALANCE: "Opening balance",
};

export const sourceLabel = (source) => JOURNAL_SOURCES[source] ?? source ?? "—";

/** A manual entry is the only kind a person may edit; the rest are consequences. */
export const isHandWritten = (entry) => entry?.source === "MANUAL" || entry?.source === "OPENING_BALANCE";

/**
 * Whether a draft's lines balance, and by how much they do not.
 *
 * Shown live while the entry is being typed. The server refuses an unbalanced
 * post, but discovering that on submit — after twelve lines — is a worse way
 * to find out than watching the difference close as you go.
 */
export function entryBalance(lines) {
  const debit = addAmounts(...lines.map((line) => line.debit || 0));
  const credit = addAmounts(...lines.map((line) => line.credit || 0));

  return {
    debit,
    credit,
    balanced: sameAmount(debit, credit) && !sameAmount(debit, "0"),
    empty: sameAmount(debit, "0") && sameAmount(credit, "0"),
    difference: minusAmounts(debit, credit),
  };
}

/**
 * The one invariant a line must satisfy: money on exactly one side.
 *
 * A line with both a debit and a credit is not a smaller entry, it is an
 * ambiguous one, and the ledger has no way to represent it.
 */
export function lineProblem(line) {
  const hasDebit = !sameAmount(line.debit || 0, "0");
  const hasCredit = !sameAmount(line.credit || 0, "0");

  if (!line.accountId) return "Pick an account";
  if (hasDebit && hasCredit) return "Put the amount on one side only";
  if (!hasDebit && !hasCredit) return "Enter a debit or a credit";
  if (String(line.debit ?? "").startsWith("-") || String(line.credit ?? "").startsWith("-")) {
    return "Use the other column instead of a negative";
  }
  return null;
}

export function journalPayload(form) {
  return {
    entryDate: form.entryDate,
    memo: form.memo?.trim() || null,
    branchId: form.branchId || null,
    lines: form.lines
      .filter((line) => line.accountId)
      .map((line, index) => ({
        accountId: line.accountId,
        debit: Number(line.debit || 0),
        credit: Number(line.credit || 0),
        description: line.description?.trim() || null,
        sortOrder: index,
      })),
  };
}

// --- accounting periods -----------------------------------------------------

export const PERIOD_STATES = {
  OPEN: { label: "Open", tone: CHIP.live, note: "Entries can still be posted into it." },
  CLOSED: { label: "Closed", tone: CHIP.warn, note: "Nothing new posts here. It can be reopened." },
  LOCKED: { label: "Locked", tone: CHIP.bad, note: "Final. It cannot be reopened." },
};

/**
 * What closing this period would actually do, in advance.
 *
 * Closing is reversible and locking is not, and the difference is worth
 * stating at the moment of the click rather than in a help page.
 */
export function periodAction(period, { drafts = 0, earlierOpen = 0 } = {}) {
  if (!period) return null;
  if (period.status === "LOCKED") return { can: false, reason: "This period is locked for good." };

  if (period.status === "CLOSED") {
    return { can: true, verb: "reopen", warning: "Reopening lets figures move again in a month that may already have been reported." };
  }
  if (drafts > 0) {
    return { can: false, reason: `${drafts} draft ${drafts === 1 ? "entry is" : "entries are"} still unposted in this period.` };
  }
  if (earlierOpen > 0) {
    return { can: false, reason: "An earlier period is still open. Close the months in order, or this one can change underneath it." };
  }
  return { can: true, verb: "close", warning: "Nothing will post into this period afterwards." };
}

// --- tax --------------------------------------------------------------------

/**
 * Several rates on one group, combined.
 *
 * Compound rates stack on the running total rather than on the net, which is
 * the entire reason this is not a sum. Getting it wrong understates the tax on
 * every single line.
 */
export function combinedRate(rates = []) {
  // Worked on a notional net of 100, so the answer reads straight off as a
  // percentage. A compound rate is charged on the net *plus* everything added
  // before it, which is why this is not a sum.
  // Kept at the column's own four decimal places all the way through. The
  // two-decimal money helpers would round 2.5625 to 2.56 mid-calculation, and
  // a tax rate is not money — it multiplies every line on every order, so a
  // hundredth of a percent lost here is lost on all of them.
  let total = decimal("0");

  for (const rate of [...rates].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
    if (rate.isActive === false) continue;

    const base = rate.isCompound ? add(decimal("100"), total) : decimal("100");
    total = add(total, percentOf(base, decimal(rate.rate ?? 0)));
  }

  return unscale(total, 4);
}

export const taxGroupPayload = (form) => ({
  name: form.name?.trim(),
  isInclusive: Boolean(form.isInclusive),
  isActive: form.isActive !== false,
});

export const taxRatePayload = (form) => ({
  name: form.name?.trim(),
  rate: Number(form.rate),
  accountId: form.accountId || null,
  region: form.region?.trim() || null,
  isCompound: Boolean(form.isCompound),
  sortOrder: Number(form.sortOrder ?? 0),
  isActive: form.isActive !== false,
});

// --- statements -------------------------------------------------------------

export const REPORTS = [
  { key: "profit-and-loss", label: "Profit & loss", permission: "financial_reports.view_pnl", blurb: "What was earned and spent over a period." },
  { key: "balance-sheet", label: "Balance sheet", permission: "financial_reports.view_balance_sheet", blurb: "What the business owns and owes on a date." },
  { key: "trial-balance", label: "Trial balance", permission: "financial_reports.view_trial_balance", blurb: "Every account, and whether the books agree." },
  { key: "cash-flow", label: "Cash flow", permission: "financial_reports.view_cash_flow", blurb: "What actually moved through cash and bank." },
];

/**
 * How a statement should describe its own coverage.
 *
 * A report that does not say what it covers is the dangerous kind: a manager
 * reads "Profit & loss" and assumes it is the company's, when it is their two
 * outlets. Scoping is invisible by design, so the page has to say it out loud.
 */
export function coverageLabel({ branchName = null, scopedBranches = [], allBranches = false }) {
  if (branchName) return branchName;
  if (allBranches) return "All branches";
  if (!scopedBranches.length) return "No branches";
  if (scopedBranches.length === 1) return scopedBranches[0];
  return `${scopedBranches.length} branches you can see`;
}

/**
 * Whether a statement can be trusted, in one sentence.
 *
 * The books agreeing is not a detail for the bottom of the page. If debits do
 * not equal credits then every figure above is suspect, and saying so at the
 * top is the difference between a report and a trap.
 */
export function statementHealth({ balanced = true, kind = "trial balance" }) {
  if (balanced) return null;
  return {
    tone: "bg-error-container text-on-error-container",
    title: "These figures do not add up",
    body: `The ${kind} is out of balance, which means something was written to the ledger without going through the posting rules. Treat every number on this page as unreliable until it is found.`,
  };
}

/** A percentage for display, from two money strings. Null when there is no base. */
export function marginPercent(profit, revenue) {
  if (sameAmount(revenue ?? 0, "0")) return null;
  const ratio = (Number(profit ?? 0) / Number(revenue)) * 100;
  if (!Number.isFinite(ratio)) return null;
  return Math.round(ratio * 10) / 10;
}

// --- shared -----------------------------------------------------------------

export function dateLabel(value) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function timeLabel(value, timeZone = undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone });
}

/** An `<input type="date">` value from a date, in the viewer's own day. */
export function toDateInput(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The month just gone, which is what a statement is almost always run for. */
export function lastMonth(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { from: toDateInput(start), to: toDateInput(end) };
}

/** This month so far — the other default people reach for. */
export function monthToDate(now = new Date()) {
  return {
    from: toDateInput(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
    to: toDateInput(now),
  };
}

// --- invoices ---------------------------------------------------------------

/**
 * A request to issue an invoice, as the order screen holds it.
 *
 * Every field is optional, because the common case is a customer who just
 * wants a numbered document and the service falls back to the name already on
 * the order. The one thing worth enforcing here is that a tax number without a
 * name is useless on a tax document — that is the mistake somebody makes when
 * they paste a company registration into the first box they see.
 *
 * The address is sent in the same `{ line1, line2, city, postalCode }` shape
 * every other address in the system uses, so an invoice address and a delivery
 * address can be read by the same code.
 */
export function invoicePayload(form = {}) {
  const errors = {};
  const text = (value) => {
    const trimmed = String(value ?? "").trim();
    return trimmed.length ? trimmed : null;
  };

  const name = text(form.name);
  const taxId = text(form.taxId);
  const address = {
    ...(text(form.line1) ? { line1: text(form.line1) } : {}),
    ...(text(form.line2) ? { line2: text(form.line2) } : {}),
    ...(text(form.city) ? { city: text(form.city) } : {}),
    ...(text(form.postalCode) ? { postalCode: text(form.postalCode) } : {}),
  };

  if (taxId && !name) errors.name = "A tax number needs the name it belongs to.";

  return {
    body: {
      ...(name ? { name } : {}),
      ...(taxId ? { taxId } : {}),
      ...(Object.keys(address).length ? { address } : {}),
    },
    errors,
  };
}

/**
 * An address printed as lines, whatever subset of keys it carries.
 *
 * Two shapes are in play and both have to print: a customer address snapshot
 * says `line1`, a branch record says `addressLine1`. Reading only one of them
 * dropped the street off the top of the invoice and left the issuer as a city
 * and a postcode.
 */
export function addressLines(address) {
  if (!address || typeof address !== "object") return [];
  const known = [
    ["line1", "addressLine1"],
    ["line2", "addressLine2"],
    ["city"],
    ["state"],
    ["postalCode"],
    ["country"],
  ];
  const lines = known
    .map((keys) => keys.map((key) => address[key]).find((value) => typeof value === "string" && value.trim()))
    .filter(Boolean);
  if (lines.length) return lines;
  // An address stored in some other shape is still better shown than dropped.
  return Object.values(address).filter((value) => typeof value === "string" && value.trim());
}

// --- cash drawers -----------------------------------------------------------

/**
 * Opening a drawer, as the form holds it.
 *
 * The float is allowed to be zero and is not allowed to be blank: those are
 * different claims. Zero says the till was empty and somebody looked; blank
 * says nobody counted, and a variance measured from a figure nobody counted is
 * not a variance.
 */
export function drawerPayload(form = {}) {
  const errors = {};
  const branchId = String(form.branchId ?? "").trim();
  const registerName = String(form.registerName ?? "").trim();
  const float = String(form.openingFloat ?? "").trim();

  if (!branchId) errors.branchId = "Choose the branch this drawer is at.";
  if (!registerName) errors.registerName = "Name the drawer, so a variance has somewhere to land.";
  else if (registerName.length > 40) errors.registerName = "Keep the name under 40 characters.";

  if (!float) errors.openingFloat = "Count the float first — enter 0 if the till is empty.";
  else if (!/^\d+(\.\d{1,2})?$/.test(float.replace(/,/g, ""))) errors.openingFloat = "Enter an amount, e.g. 5000 or 5000.50";

  return {
    body: {
      branchId,
      registerName,
      openingFloat: Number(float.replace(/,/g, "") || 0),
    },
    errors,
  };
}
