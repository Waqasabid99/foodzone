import { parseCost, parseQuantity } from "@/lib/inventory";
import {
  ZERO,
  add,
  addAmounts,
  atLeastZero,
  compare,
  decimal,
  multiply,
  percentOf,
  subtract,
  unscale,
} from "@/lib/money-math";

/** Re-exported so the purchasing screens have one import for their arithmetic. */
export { addAmounts };

/**
 * Words and form rules for the Purchasing screens.
 *
 * Pure, so the rule a form enforces before sending sits beside the sentence it
 * shows when the rule is broken. The server checks all of it again — this only
 * saves a round trip.
 *
 * The chain these screens describe is four documents and three different
 * moments, and keeping them apart is the whole design:
 *
 *   * a **purchase order** is a promise to buy, and moves nothing;
 *   * a **goods receipt** is food arriving, and is the only one of the four
 *     that touches stock;
 *   * a **supplier bill** is the invoice, which turns up days later and is
 *     what creates the payable;
 *   * a **payment** is money leaving.
 *
 * A system that collapses any two of them tells you it has stock it has not
 * received, or owes money nobody has invoiced.
 */


/**
 * What an order comes to, line by line.
 *
 * The order of operations matches the server's: discount comes off the line
 * before tax is worked out, because tax is owed on what is actually paid. Doing
 * it the other way over-taxes every discounted line, and the difference is
 * invisible until a supplier disputes an invoice.
 */
export function orderTotals(lines = [], { shippingCost = 0 } = {}) {
  let subtotal = ZERO;
  let taxTotal = ZERO;
  let discountTotal = ZERO;

  const priced = (lines ?? []).map((line) => {
    const gross = multiply(decimal(line.quantity), decimal(line.unitPrice));
    const discount = decimal(line.discountAmount ?? 0);
    const net = atLeastZero(subtract(gross, discount));
    const tax = percentOf(net, decimal(line.taxRate ?? 0));

    subtotal = add(subtotal, net);
    taxTotal = add(taxTotal, tax);
    discountTotal = add(discountTotal, discount);

    return { lineTotal: unscale(net), tax: unscale(tax) };
  });

  const shipping = decimal(shippingCost);
  return {
    lines: priced,
    subtotal: unscale(subtotal),
    taxTotal: unscale(taxTotal),
    discountTotal: unscale(discountTotal),
    shippingCost: unscale(shipping),
    grandTotal: unscale(add(add(subtotal, taxTotal), shipping)),
  };
}

/**
 * What a delivery comes to.
 *
 * Priced on the **accepted** quantity, never the delivered one. What arrived
 * and what was kept are different numbers, and the difference is the entire
 * point of inspecting a delivery: rejected goods are not bought, do not enter
 * stock, and must not appear on the bill.
 */
export function receiptTotals(lines = [], { landedCost = 0 } = {}) {
  let subtotal = ZERO;
  let taxTotal = ZERO;

  const priced = (lines ?? []).map((line) => {
    const accepted = atLeastZero(subtract(decimal(line.quantity), decimal(line.rejectedQuantity ?? 0)));
    const net = multiply(accepted, decimal(line.unitCost));
    const tax = percentOf(net, decimal(line.taxRate ?? 0));

    subtotal = add(subtotal, net);
    taxTotal = add(taxTotal, tax);

    return { accepted: unscale(accepted, 6), lineTotal: unscale(net) };
  });

  const landed = decimal(landedCost);
  return {
    lines: priced,
    subtotal: unscale(subtotal),
    taxTotal: unscale(taxTotal),
    landedCost: unscale(landed),
    grandTotal: unscale(add(add(subtotal, taxTotal), landed)),
  };
}

/** What is still owed on a bill. */
export const outstandingOf = (bill) => unscale(subtract(decimal(bill?.grandTotal), decimal(bill?.paidAmount)));

/** Whether two money strings are the same amount, whatever they look like. */
export const sameAmount = (a, b) => unscale(decimal(a)) === unscale(decimal(b));

// --- suppliers --------------------------------------------------------------

export const SUPPLIER_TERMS = [
  { value: 0, label: "On delivery" },
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 15, label: "15 days" },
  { value: 30, label: "30 days" },
  { value: 45, label: "45 days" },
  { value: 60, label: "60 days" },
];

export const termLabel = (days) =>
  days == null ? "Not agreed" : (SUPPLIER_TERMS.find((row) => row.value === days)?.label ?? `${days} days`);

const trimmed = (value) => {
  const text = String(value ?? "").trim();
  return text || null;
};

/**
 * A supplier, as the form holds it.
 *
 * The code is uppercased here as well as on the server, so the field a person
 * is looking at shows what will actually be stored rather than changing under
 * them after they save.
 */
export function supplierPayload(form, { isNew = true } = {}) {
  const errors = {};
  const code = String(form.code ?? "").trim().toUpperCase();
  const name = String(form.name ?? "").trim();

  if (isNew || form.code !== undefined) {
    if (code.length < 2) errors.code = "Give them a short code, at least 2 characters.";
    else if (code.length > 20) errors.code = "Keep the code to 20 characters or fewer.";
  }
  if (!name) errors.name = "Give them a name.";
  else if (name.length > 160) errors.name = "That name is too long.";

  const email = trimmed(form.email);
  if (email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) errors.email = "That does not look like an email address.";

  const credit = parseCost(form.creditLimit, { optional: true });
  if (credit.error) errors.creditLimit = credit.error;

  const terms = form.paymentTermDays === "" || form.paymentTermDays == null ? null : Number(form.paymentTermDays);
  if (terms != null && (!Number.isInteger(terms) || terms < 0 || terms > 365)) {
    errors.paymentTermDays = "Payment terms are a whole number of days, up to 365.";
  }

  const rating = form.rating === "" || form.rating == null ? null : Number(form.rating);
  if (rating != null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    errors.rating = "Rate them from 1 to 5, or leave it blank.";
  }

  return {
    body: {
      code,
      name,
      contactPerson: trimmed(form.contactPerson),
      email,
      phone: trimmed(form.phone),
      addressLine1: trimmed(form.addressLine1),
      city: trimmed(form.city),
      state: trimmed(form.state),
      country: trimmed(form.country),
      postalCode: trimmed(form.postalCode),
      taxIdentifier: trimmed(form.taxIdentifier),
      ...(terms != null ? { paymentTermDays: terms } : {}),
      creditLimit: credit.value ?? null,
      rating,
      notes: trimmed(form.notes),
      isActive: form.isActive !== false,
    },
    errors,
  };
}

/** One line of a supplier's price list. */
export function supplierItemPayload(form) {
  const errors = {};
  if (!form.itemId) errors.itemId = "Choose an item.";

  const price = parseCost(form.unitPrice, { optional: false });
  if (price.error) errors.unitPrice = price.error;

  const minimum = parseCost(form.minOrderQuantity, { optional: true });
  if (minimum.error) errors.minOrderQuantity = minimum.error;

  const lead = form.leadTimeDays === "" || form.leadTimeDays == null ? null : Number(form.leadTimeDays);
  if (lead != null && (!Number.isInteger(lead) || lead < 0 || lead > 365)) {
    errors.leadTimeDays = "Lead time is a whole number of days.";
  }

  return {
    body: {
      itemId: form.itemId,
      supplierSku: trimmed(form.supplierSku),
      ...(form.uomId ? { uomId: form.uomId } : {}),
      unitPrice: price.value,
      minOrderQuantity: minimum.value ?? null,
      leadTimeDays: lead,
      isPreferred: Boolean(form.isPreferred),
    },
    errors,
  };
}

// --- purchase orders --------------------------------------------------------

export const PO_STATES = {
  DRAFT: { label: "Draft", tone: "bg-surface-container-high text-on-surface-variant" },
  PENDING_APPROVAL: { label: "Waiting for approval", tone: "bg-warning-container text-on-warning-container" },
  APPROVED: { label: "Approved", tone: "bg-secondary-container text-on-secondary-container" },
  SENT: { label: "Sent to supplier", tone: "bg-secondary-container text-on-secondary-container" },
  PARTIALLY_RECEIVED: { label: "Part delivered", tone: "bg-warning-container text-on-warning-container" },
  RECEIVED: { label: "Delivered", tone: "bg-success-container text-on-success-container" },
  CLOSED: { label: "Closed", tone: "bg-surface-container-high text-on-surface-variant" },
  CANCELLED: { label: "Cancelled", tone: "bg-surface-container-high text-on-surface-variant" },
};

/** What each stage commits, said before the button is pressed rather than after. */
export const PO_STAGE_HINT = {
  DRAFT: "Nothing has been promised yet. Edit it freely, then send it for approval.",
  PENDING_APPROVAL: "Waiting for somebody who can commit the money. Still editable until they do.",
  APPROVED: "Signed off and fixed. Send it to the supplier, then receive against it when the food turns up.",
  SENT: "The supplier has it. Receive against it as deliveries arrive.",
  PARTIALLY_RECEIVED: "Some of it has arrived. Receive the rest, or close it short if it is never coming.",
  RECEIVED: "Everything ordered has arrived.",
  CLOSED: "Ended early. What arrived was kept; the rest is no longer expected.",
  CANCELLED: "Called off before anything was delivered.",
};

export const PO_FILTERS = [
  { value: "", label: "All" },
  { value: "DRAFT", label: "Drafts" },
  { value: "PENDING_APPROVAL", label: "To approve" },
  { value: "SENT", label: "Sent" },
  { value: "PARTIALLY_RECEIVED", label: "Part delivered" },
  { value: "RECEIVED", label: "Delivered" },
];

/** Editable only before somebody signs it off — after that it is what they signed. */
export const poEditable = (status) => ["DRAFT", "PENDING_APPROVAL"].includes(status);
export const poReceivable = (status) => ["APPROVED", "SENT", "PARTIALLY_RECEIVED"].includes(status);
export const poOpen = (status) => !["RECEIVED", "CLOSED", "CANCELLED"].includes(status);

/**
 * Whether cancelling is still honest.
 *
 * Once anything has been delivered the goods exist and the supplier is owed for
 * them. What is needed then is a short close, not a cancellation that pretends
 * the delivery never happened.
 */
export const poCancellable = (order) =>
  poOpen(order?.status) && !(order?.items ?? []).some((line) => Number(line.receivedQuantity ?? 0) > 0);

export function purchaseOrderPayload({ branchId, supplierId, expectedAt, shippingCost, notes, lines }) {
  const errors = {};
  const lineErrors = {};

  if (!branchId) errors.branchId = "Choose which branch is buying.";
  if (!supplierId) errors.supplierId = "Choose a supplier.";

  const shipping = parseCost(shippingCost, { optional: true });
  if (shipping.error) errors.shippingCost = shipping.error;

  const items = [];
  const seen = new Set();

  (lines ?? []).forEach((line, index) => {
    const problems = {};
    if (!line.itemId) problems.itemId = "Choose an item.";
    else if (seen.has(line.itemId)) problems.itemId = "This item is already on the order.";
    else seen.add(line.itemId);

    const quantity = parseQuantity(line.quantity);
    if (quantity.error) problems.quantity = quantity.error;

    // A price is required here even though the server would fall back to the
    // agreed list, because the form has already filled the box from that list:
    // an empty one means the item has no agreed price, and guessing is how a
    // restaurant finds out what it paid after the invoice arrives.
    const price = parseCost(line.unitPrice, { optional: false });
    if (price.error) problems.unitPrice = price.error;

    const discount = parseCost(line.discountAmount, { optional: true });
    if (discount.error) problems.discountAmount = discount.error;

    const rate = line.taxRate === "" || line.taxRate == null ? null : Number(line.taxRate);
    if (rate != null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) {
      problems.taxRate = "A tax rate is a percentage from 0 to 100.";
    }

    if (Object.keys(problems).length) lineErrors[index] = problems;
    else {
      items.push({
        itemId: line.itemId,
        quantity: quantity.value,
        ...(line.uomId ? { uomId: line.uomId } : {}),
        unitPrice: price.value,
        ...(rate ? { taxRate: rate } : {}),
        ...(discount.value ? { discountAmount: discount.value } : {}),
        ...(String(line.notes ?? "").trim() ? { notes: String(line.notes).trim() } : {}),
      });
    }
  });

  if (!lines?.length) errors.items = "Add at least one item.";
  else if (Object.keys(lineErrors).length) errors.items = "Some lines need attention.";

  return {
    body: {
      branchId,
      supplierId,
      expectedAt: expectedAt || null,
      ...(shipping.value ? { shippingCost: shipping.value } : {}),
      notes: trimmed(notes),
      items,
    },
    errors,
    lineErrors,
  };
}

// --- goods receipts ---------------------------------------------------------

export const GRN_STATES = {
  DRAFT: { label: "Draft", tone: "bg-warning-container text-on-warning-container" },
  PENDING_APPROVAL: { label: "Waiting for approval", tone: "bg-warning-container text-on-warning-container" },
  APPROVED: { label: "Approved", tone: "bg-secondary-container text-on-secondary-container" },
  REJECTED: { label: "Rejected", tone: "bg-error-container text-on-error-container" },
  COMPLETED: { label: "In stock", tone: "bg-success-container text-on-success-container" },
  CANCELLED: { label: "Cancelled", tone: "bg-surface-container-high text-on-surface-variant" },
};

export const GRN_STAGE_HINT = {
  DRAFT: "Nothing has moved yet. Check it against the delivery, then post it to put the stock in.",
  COMPLETED: "Posted. The stock is in, the order is updated, and what was delivered is now on the books.",
  CANCELLED: "Thrown away before it moved anything.",
};

export const grnPostable = (status) => ["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(status);

/**
 * A delivery, as the receiving form holds it.
 *
 * `rejectedQuantity` is deliberately a separate box rather than something a
 * person subtracts themselves: the quantity the supplier says they delivered
 * and the quantity actually kept are two facts, and keeping both is what makes
 * a short-delivery argument winnable a month later.
 */
export function goodsReceiptPayload({
  locationId,
  supplierId,
  purchaseOrderId,
  supplierInvoiceNumber,
  receivedAt,
  landedCost,
  notes,
  lines,
  tracksBatches = () => false,
}) {
  const errors = {};
  const lineErrors = {};

  if (!locationId) errors.locationId = "Choose where the stock is going.";
  if (!supplierId) errors.supplierId = "Choose who delivered it.";

  const landed = parseCost(landedCost, { optional: true });
  if (landed.error) errors.landedCost = landed.error;

  const items = [];

  (lines ?? []).forEach((line, index) => {
    // A line left entirely blank on a receipt built from an order means "none
    // of this arrived", which is a legitimate answer and not an error.
    const blank = !String(line.quantity ?? "").trim() && !String(line.rejectedQuantity ?? "").trim();
    if (blank && line.optional) return;

    const problems = {};
    if (!line.itemId) problems.itemId = "Choose an item.";

    const quantity = parseQuantity(line.quantity);
    if (quantity.error) problems.quantity = quantity.error;

    const rejected = parseQuantity(line.rejectedQuantity, { allowZero: true });
    if (String(line.rejectedQuantity ?? "").trim() && rejected.error) problems.rejectedQuantity = rejected.error;

    const rejectedValue = String(line.rejectedQuantity ?? "").trim() ? (rejected.value ?? 0) : 0;
    if (!quantity.error && rejectedValue > quantity.value) {
      problems.rejectedQuantity = "You cannot reject more than was delivered.";
    }

    const cost = parseCost(line.unitCost, { optional: false });
    if (cost.error) problems.unitCost = cost.error;

    // A batch-tracked item with no number gets one from the receipt, so this is
    // a nudge rather than a refusal — but an expiry on a perishable is not
    // something to invent, so it is left to the item's shelf life instead.
    if (Object.keys(problems).length) lineErrors[index] = problems;
    else {
      items.push({
        itemId: line.itemId,
        ...(line.purchaseOrderItemId ? { purchaseOrderItemId: line.purchaseOrderItemId } : {}),
        quantity: quantity.value,
        ...(rejectedValue ? { rejectedQuantity: rejectedValue } : {}),
        ...(line.uomId ? { uomId: line.uomId } : {}),
        unitCost: cost.value,
        ...(line.taxRate ? { taxRate: Number(line.taxRate) } : {}),
        ...(tracksBatches(line.itemId) && String(line.batchNumber ?? "").trim()
          ? { batchNumber: String(line.batchNumber).trim() }
          : {}),
        ...(line.expiryDate ? { expiryDate: line.expiryDate } : {}),
      });
    }
  });

  if (!items.length && !Object.keys(lineErrors).length) errors.items = "Nothing has been received. Enter what arrived.";
  else if (Object.keys(lineErrors).length) errors.items = "Some lines need attention.";

  return {
    body: {
      locationId,
      supplierId,
      ...(purchaseOrderId ? { purchaseOrderId } : {}),
      supplierInvoiceNumber: trimmed(supplierInvoiceNumber),
      ...(receivedAt ? { receivedAt } : {}),
      ...(landed.value ? { landedCost: landed.value } : {}),
      notes: trimmed(notes),
      items,
    },
    errors,
    lineErrors,
  };
}

// --- supplier bills ---------------------------------------------------------

export const BILL_STATES = {
  DRAFT: { label: "Draft", tone: "bg-surface-container-high text-on-surface-variant" },
  AWAITING_APPROVAL: { label: "Waiting for approval", tone: "bg-warning-container text-on-warning-container" },
  APPROVED: { label: "Approved", tone: "bg-secondary-container text-on-secondary-container" },
  PARTIALLY_PAID: { label: "Part paid", tone: "bg-warning-container text-on-warning-container" },
  PAID: { label: "Paid", tone: "bg-success-container text-on-success-container" },
  OVERDUE: { label: "Overdue", tone: "bg-error-container text-on-error-container" },
  CANCELLED: { label: "Cancelled", tone: "bg-surface-container-high text-on-surface-variant" },
};

export const BILL_STAGE_HINT = {
  DRAFT: "Transcribed but not agreed. It is not a payable yet and nothing has reached the ledger.",
  AWAITING_APPROVAL: "Waiting for somebody to agree the restaurant owes this.",
  APPROVED: "Agreed and posted to payables. Record payments against it as they go out.",
  PARTIALLY_PAID: "Some of it has been paid. The rest is still owed.",
  PAID: "Settled in full.",
  OVERDUE: "Past its due date and still owed.",
  CANCELLED: "Written off the payables. Any posted entry was reversed.",
};

export const BILL_FILTERS = [
  { value: "", label: "All" },
  { value: "DRAFT", label: "Drafts" },
  { value: "AWAITING_APPROVAL", label: "To approve" },
  { value: "APPROVED", label: "Unpaid" },
  { value: "PARTIALLY_PAID", label: "Part paid" },
  { value: "PAID", label: "Paid" },
];

export const billPayable = (status) => ["APPROVED", "PARTIALLY_PAID", "OVERDUE"].includes(status);
export const billApprovable = (status) => ["DRAFT", "AWAITING_APPROVAL"].includes(status);

export const PAYMENT_METHODS = {
  BANK_TRANSFER: "Bank transfer",
  CASH: "Cash",
  CHEQUE: "Cheque",
  CARD: "Card",
  OTHER: "Other",
};

/**
 * How late a bill is, in the words a payment run uses.
 *
 * Counted in whole days against a date rather than a timestamp: a bill due
 * today is due today all day, and telling somebody it is overdue at one minute
 * past midnight would have them chasing a supplier who is not late.
 */
export function dueState(bill, { now = new Date() } = {}) {
  if (!bill?.dueDate) return { label: "No due date", tone: "text-on-surface-variant", days: null };
  if (bill.status === "PAID") return { label: "Paid", tone: "text-on-surface-variant", days: null };
  if (bill.status === "CANCELLED") return { label: "Cancelled", tone: "text-on-surface-variant", days: null };

  const due = new Date(bill.dueDate);
  const days = Math.floor(
    (Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate()) -
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) /
      86_400_000,
  );

  if (days < 0) return { label: `${-days} ${-days === 1 ? "day" : "days"} overdue`, tone: "text-error", days };
  if (days === 0) return { label: "Due today", tone: "text-error", days };
  if (days <= 7) return { label: `Due in ${days} ${days === 1 ? "day" : "days"}`, tone: "text-on-surface", days };
  return { label: `Due in ${days} days`, tone: "text-on-surface-variant", days };
}

/**
 * The ageing columns, in the words a payment run uses.
 *
 * The keys are the server's own bucket names — see `AGEING_BUCKETS` in
 * `src/server/accounting/reports.js` — so the two cannot drift into showing a
 * column that is always empty.
 */
export const AGEING_BUCKETS = [
  { key: "current", label: "Not yet due", tone: "text-on-surface" },
  { key: "1-30", label: "1–30 days late", tone: "text-on-surface" },
  { key: "31-60", label: "31–60 days", tone: "text-on-surface" },
  { key: "61-90", label: "61–90 days", tone: "text-error" },
  { key: "90+", label: "Over 90 days", tone: "text-error" },
];

export function supplierBillPayload(form) {
  const errors = {};
  if (!form.supplierId) errors.supplierId = "Choose who sent the invoice.";
  if (!form.branchId) errors.branchId = "Choose which branch it belongs to.";

  const subtotal = parseCost(form.subtotal, { optional: false });
  if (subtotal.error) errors.subtotal = subtotal.error;
  else if (subtotal.value <= 0) errors.subtotal = "A bill has to be for something.";

  const tax = parseCost(form.taxTotal, { optional: true });
  if (tax.error) errors.taxTotal = tax.error;

  if (form.billDate && form.dueDate && form.dueDate < form.billDate) {
    errors.dueDate = "The due date cannot be before the invoice date.";
  }

  return {
    body: {
      supplierId: form.supplierId,
      branchId: form.branchId,
      ...(form.goodsReceiptId ? { goodsReceiptId: form.goodsReceiptId } : {}),
      supplierInvoiceNumber: trimmed(form.supplierInvoiceNumber),
      ...(form.billDate ? { billDate: form.billDate } : {}),
      dueDate: form.dueDate || null,
      subtotal: subtotal.value,
      ...(tax.value ? { taxTotal: tax.value } : {}),
      notes: trimmed(form.notes),
    },
    errors,
  };
}

/**
 * A payment against a bill.
 *
 * Overpayment is refused here as well as on the server, because the server's
 * refusal arrives after the person has left the screen believing it went
 * through — and an overpayment is almost always a duplicate of one already
 * recorded.
 */
export function billPaymentPayload(form, { outstanding = null } = {}) {
  const errors = {};
  const amount = parseCost(form.amount, { optional: false });
  if (amount.error) errors.amount = amount.error;
  else if (amount.value <= 0) errors.amount = "A payment has to be for something.";
  else if (outstanding != null && compare(decimal(amount.value), decimal(outstanding)) > 0) {
    errors.amount = `Only ${unscale(decimal(outstanding))} is still outstanding.`;
  }

  if (form.method && !PAYMENT_METHODS[form.method]) errors.method = "Choose how it was paid.";

  return {
    body: {
      amount: amount.value,
      ...(form.paidAt ? { paidAt: form.paidAt } : {}),
      accountId: form.accountId || null,
      ...(form.method ? { method: form.method } : {}),
      reference: trimmed(form.reference),
      notes: trimmed(form.notes),
    },
    errors,
  };
}

// --- dates ------------------------------------------------------------------

/** A `YYYY-MM-DD` key, kept as a string so a date column never drifts a day. */
export const dayKey = (value = new Date()) =>
  typeof value === "string" ? value.slice(0, 10) : new Date(value).toISOString().slice(0, 10);

/**
 * A date, written the way the business reads it.
 *
 * Two different kinds of value reach this function and they want opposite
 * treatment, which is why the zone is a parameter rather than a constant:
 *
 *   * A **plain calendar date** — a `@db.Date` column such as a bill date or
 *     an accounting period's start. Postgres hands those back as UTC midnight
 *     and they carry no time of day at all, so they must be read in UTC. Run
 *     one through a western zone and the 1st of the month becomes the 31st.
 *     These callers pass no zone.
 *   * An **instant** — `receivedAt`, `approvedAt`, `joinedAt`. A real moment,
 *     and which day it fell on is a question you cannot answer without a
 *     place. Read in UTC, a delivery checked in at 03:30 in Karachi is filed
 *     under the day before, on screen, against a document somebody is holding.
 *     These callers pass the store's timezone.
 *
 * The default stays UTC: right for the first kind, and right for a system
 * with no timezone configured.
 */
export function dateLabel(value, timeZone = "UTC") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone });
}
