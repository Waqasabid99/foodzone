/**
 * Inventory screens — labels, quantity formatting and the form → API payload
 * rules. Pure, so the arithmetic and the wording are unit-tested rather than
 * checked by eye.
 *
 * Quantities travel as strings from the server (Decimal columns), and are
 * formatted here without going through a float where it matters: a store room
 * counts 0.1 + 0.2 kg as 0.3, and a screen that says 0.30000000000000004 is
 * a screen nobody trusts again.
 */

export const ITEM_TYPES = [
  { value: "RAW_MATERIAL", label: "Raw material", hint: "Bought in and cooked with — flour, chicken, oil." },
  { value: "SEMI_FINISHED", label: "Prepared in-house", hint: "Made in the kitchen and used in dishes — sauces, dough." },
  { value: "FINISHED_GOOD", label: "Sold as bought", hint: "Resold unchanged — canned drinks, bottled water." },
  { value: "PACKAGING", label: "Packaging", hint: "Boxes, cups, bags, cutlery." },
  { value: "CONSUMABLE", label: "Consumable", hint: "Used up but never served — gloves, cleaning supplies." },
];

export const UNIT_TYPES = [
  { value: "WEIGHT", label: "Weight" },
  { value: "VOLUME", label: "Volume" },
  { value: "COUNT", label: "Count" },
  { value: "LENGTH", label: "Length" },
  { value: "TIME", label: "Time" },
];

export const LOCATION_TYPES = [
  { value: "MAIN_STORE", label: "Store room" },
  { value: "KITCHEN", label: "Kitchen" },
  { value: "COLD_STORAGE", label: "Cold storage" },
  { value: "BAR", label: "Bar" },
  { value: "COUNTER", label: "Counter" },
  { value: "WASTE", label: "Waste holding" },
];

export const WASTAGE_REASONS = [
  { value: "EXPIRED", label: "Expired", hint: "Past its date before it was used." },
  { value: "SPOILED", label: "Spoiled", hint: "Went off early — check the fridge or the delivery." },
  { value: "DAMAGED", label: "Damaged", hint: "Dropped, crushed, broken packaging." },
  { value: "OVER_PRODUCTION", label: "Made too much", hint: "Prepared and not sold." },
  { value: "COOKING_ERROR", label: "Cooking mistake", hint: "Burnt, wrong order, remade." },
  { value: "CUSTOMER_RETURN", label: "Sent back", hint: "Returned by a customer and thrown away." },
  { value: "SPILLAGE", label: "Spilled", hint: "Knocked over or leaked." },
  { value: "THEFT", label: "Missing / theft", hint: "Gone with no other explanation." },
  { value: "OTHER", label: "Other", hint: "Say what happened in the note." },
];

/** Reasons a person can pick when recording waste. Production loss is recorded by the run itself. */
export const RECORDABLE_WASTAGE_REASONS = WASTAGE_REASONS;

const REASON_LABELS = Object.fromEntries([...WASTAGE_REASONS, { value: "PRODUCTION_LOSS", label: "Production loss" }].map((r) => [r.value, r.label]));
export const wastageReasonLabel = (reason) => REASON_LABELS[reason] ?? reason;

/**
 * Every movement type, in words, with the direction it moves stock and where
 * the document that caused it lives.
 */
export const MOVEMENT_TYPES = {
  PURCHASE_IN: { label: "Delivery received", direction: "in" },
  PRODUCTION_IN: { label: "Made in the kitchen", direction: "in" },
  PRODUCTION_OUT: { label: "Used in production", direction: "out" },
  SALE_OUT: { label: "Sold", direction: "out" },
  TRANSFER_IN: { label: "Transfer in", direction: "in" },
  TRANSFER_OUT: { label: "Transfer out", direction: "out" },
  ADJUSTMENT_IN: { label: "Adjustment (added)", direction: "in" },
  ADJUSTMENT_OUT: { label: "Adjustment (removed)", direction: "out" },
  WASTAGE: { label: "Wasted", direction: "out" },
  RETURN_TO_SUPPLIER: { label: "Returned to supplier", direction: "out" },
  CUSTOMER_RETURN: { label: "Order reversed", direction: "in" },
  OPENING_BALANCE: { label: "Opening stock", direction: "either" },
  COUNT_CORRECTION: { label: "Count correction", direction: "either" },
};

export const movementLabel = (type) => MOVEMENT_TYPES[type]?.label ?? type;

/** Where the document behind a movement can be opened, or null when there is no screen for it. */
export function movementSource(movement) {
  const id = movement?.referenceId;
  switch (movement?.referenceType) {
    case "ADJUSTMENT":
      return id ? { href: `/dashboard/stock-adjustments/${id}`, label: "Adjustment" } : null;
    case "COUNT":
      return id ? { href: `/dashboard/stock-counts/${id}`, label: "Stock count" } : null;
    case "TRANSFER":
      return id ? { href: `/dashboard/stock-transfers/${id}`, label: "Transfer" } : null;
    case "PRODUCTION_ORDER":
    case "PRODUCTION_CANCELLED":
      return id ? { href: `/dashboard/production/${id}`, label: "Production run" } : null;
    case "WASTAGE":
    case "BATCH_WRITE_OFF":
      return { href: "/dashboard/wastage", label: "Wastage" };
    case "ORDER":
    case "ORDER_REVERSAL":
      return movement.order?.orderNumber ? { href: null, label: `Order ${movement.order.orderNumber}` } : { href: null, label: "Order" };
    default:
      return null;
  }
}

/** The two kinds of adjustment, in the words the form and the list use. */
export const ADJUSTMENT_TYPES = [
  { value: "CORRECTION", label: "Correction", short: "Correction" },
  { value: "OPENING_STOCK", label: "Opening stock", short: "Opening" },
];
export const adjustmentTypeLabel = (type) => ADJUSTMENT_TYPES.find((entry) => entry.value === type)?.label ?? "Correction";

/** Adjustment and count states, as the people approving them think of them. */
export const DOCUMENT_STATES = {
  DRAFT: { label: "Draft", tone: "bg-surface-container-high text-on-surface-variant" },
  PENDING_APPROVAL: { label: "Waiting", tone: "bg-warning-container text-on-warning-container" },
  APPROVED: { label: "Approved", tone: "bg-secondary-container text-on-secondary-container" },
  COMPLETED: { label: "Posted", tone: "bg-success-container text-on-success-container" },
  REJECTED: { label: "Rejected", tone: "bg-surface-container-high text-on-surface-variant" },
  CANCELLED: { label: "Cancelled", tone: "bg-surface-container-high text-on-surface-variant" },
};

/** A stock count's own words: a draft is a sheet being counted. */
export const COUNT_STATES = {
  ...DOCUMENT_STATES,
  DRAFT: { label: "Counting", tone: "bg-secondary-container text-on-secondary-container" },
  PENDING_APPROVAL: { label: "Waiting to post", tone: "bg-warning-container text-on-warning-container" },
};

export const TRANSFER_STAGES = [
  { value: "DRAFT", label: "Not sent", tone: "bg-surface-container-high text-on-surface-variant" },
  { value: "IN_TRANSIT", label: "On the way", tone: "bg-warning-container text-on-warning-container" },
  { value: "RECEIVED", label: "Received", tone: "bg-success-container text-on-success-container" },
  { value: "CANCELLED", label: "Cancelled", tone: "bg-surface-container-high text-on-surface-variant" },
];

/** Where a transfer is, from its fields rather than its status alone. */
export function transferStage(transfer) {
  if (!transfer) return TRANSFER_STAGES[0];
  if (transfer.status === "CANCELLED" || transfer.status === "REJECTED") return TRANSFER_STAGES[3];
  if (transfer.receivedAt || transfer.status === "COMPLETED") return TRANSFER_STAGES[2];
  if (transfer.dispatchedAt) return TRANSFER_STAGES[1];
  return TRANSFER_STAGES[0];
}

/** Decided by the same person who raised it — allowed, and said out loud. */
export function selfApproved(raisedBy, decidedBy) {
  return Boolean(raisedBy && decidedBy && raisedBy === decidedBy);
}

// --- quantities ---------------------------------------------------------------

/**
 * A decimal string, trimmed to what the unit can count.
 *
 * `precision` is the unit's own (pieces: 0, kilograms: 3). Rounds half away
 * from zero on the decimal digits themselves, so "2.0005" kg reads 2.001 and
 * never 2.0004999.
 */
export function formatQuantity(value, { precision = 3, unit = null, signed = false } = {}) {
  if (value === null || value === undefined || value === "") return "—";
  const text = roundDecimalString(String(value), precision);
  if (text === null) return "—";

  const negative = text.startsWith("-");
  const [whole, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmed = fraction.replace(/0+$/, "");
  const body = trimmed ? `${grouped}.${trimmed}` : grouped;
  const isZero = !/[1-9]/.test(body);
  const sign = negative && !isZero ? "−" : signed && !isZero ? "+" : "";
  return `${sign}${body}${unit ? ` ${unit}` : ""}`;
}

/** Decimal-string rounding with no float in between. Null for anything that is not a number. */
export function roundDecimalString(input, places) {
  const match = /^\s*(-)?(\d*)(?:\.(\d*))?\s*$/.exec(input);
  if (!match || (!match[2] && !match[3])) return null;
  const negative = Boolean(match[1]);
  const whole = (match[2] || "0").replace(/^0+(?=\d)/, "");
  const fraction = match[3] ?? "";
  const digits = Math.max(0, Math.min(6, places));

  if (fraction.length <= digits) {
    const padded = fraction.padEnd(digits, "0");
    return `${negative ? "-" : ""}${whole}${digits ? `.${padded}` : ""}`;
  }

  // Round on the digit string: add one unit in the last kept place when the
  // first dropped digit is 5 or more, carrying leftwards as far as it goes.
  const kept = (whole + fraction.slice(0, digits)).split("").map(Number);
  if (Number(fraction[digits]) >= 5) {
    let index = kept.length - 1;
    while (index >= 0) {
      if (kept[index] === 9) {
        kept[index] = 0;
        index -= 1;
      } else {
        kept[index] += 1;
        break;
      }
    }
    if (index < 0) kept.unshift(1);
  }
  const all = kept.join("");
  const wholePart = all.slice(0, all.length - digits) || "0";
  const fractionPart = all.slice(all.length - digits);
  return `${negative ? "-" : ""}${wholePart}${digits ? `.${fractionPart}` : ""}`;
}

/**
 * What someone typed into a quantity box, as a number the API accepts, or an
 * error in words. Commas are accepted as thousands separators ("1,250").
 */
export function parseQuantity(input, { allowZero = false, allowNegative = false, max = 999_999_999 } = {}) {
  const text = String(input ?? "").trim().replace(/,/g, "");
  if (!text) return { error: "Enter a quantity." };
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(text)) return { error: "Enter a number, e.g. 2.5." };
  const [, fraction = ""] = text.replace("-", "").split(".");
  if (fraction.length > 6) return { error: "Use at most 6 decimal places." };
  const value = Number(text);
  if (!Number.isFinite(value) || Math.abs(value) > max) return { error: "That number is too large." };
  if (value < 0 && !allowNegative) return { error: "Enter a positive number." };
  if (value === 0 && !allowZero) return { error: "Enter more than zero." };
  return { value };
}

/** A price per unit, typed in money. Blank is allowed where the caller says so. */
export function parseCost(input, { optional = true } = {}) {
  const text = String(input ?? "").trim().replace(/,/g, "");
  if (!text) return optional ? { value: undefined } : { error: "Enter a cost." };
  if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return { error: "Enter an amount, e.g. 450." };
  const [, fraction = ""] = text.split(".");
  if (fraction.length > 6) return { error: "Use at most 6 decimal places." };
  const value = Number(text);
  if (!Number.isFinite(value) || value > 999_999_999) return { error: "That amount is too large." };
  return { value };
}

/** Expiry, as a kitchen reads it: gone, today, soon, or fine. */
export function expiryState(expiryDate, { now = new Date(), soonDays = 3 } = {}) {
  if (!expiryDate) return { label: "No expiry", tone: "text-on-surface-variant", days: null };
  const days = Math.floor((new Date(expiryDate).getTime() - now.getTime()) / 86_400_000);
  if (new Date(expiryDate) <= now) {
    return { label: "Expired", tone: "bg-error-container text-on-error-container", days };
  }
  if (days === 0) return { label: "Expires today", tone: "bg-error-container text-on-error-container", days };
  if (days <= soonDays) {
    return { label: `${days} ${days === 1 ? "day" : "days"} left`, tone: "bg-warning-container text-on-warning-container", days };
  }
  return { label: `${days} days left`, tone: "bg-surface-container-high text-on-surface-variant", days };
}

// --- forms ----------------------------------------------------------------------

export const ITEM_FIELDS = [
  "name",
  "sku",
  "type",
  "categoryId",
  "uomId",
  "description",
  "barcode",
  "costingMethod",
  "isPerishable",
  "trackBatches",
  "shelfLifeDays",
  "reorderLevel",
  "reorderQuantity",
  "yieldPercent",
];

export function itemFormValues(item = null) {
  return {
    name: item?.name ?? "",
    sku: item?.sku ?? "",
    type: item?.type ?? "RAW_MATERIAL",
    categoryId: item?.categoryId ?? "",
    uomId: item?.uomId ?? "",
    description: item?.description ?? "",
    barcode: item?.barcode ?? "",
    costingMethod: item?.costingMethod ?? "WEIGHTED_AVERAGE",
    isPerishable: Boolean(item?.isPerishable),
    trackBatches: Boolean(item?.trackBatches),
    shelfLifeDays: item?.shelfLifeDays == null ? "" : String(item.shelfLifeDays),
    reorderLevel: item?.reorderLevel == null ? "" : trimZeros(String(item.reorderLevel)),
    reorderQuantity: item?.reorderQuantity == null ? "" : trimZeros(String(item.reorderQuantity)),
    yieldPercent: item?.yieldPercent == null ? "100" : trimZeros(String(item.yieldPercent)),
  };
}

function trimZeros(text) {
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

/**
 * The item form → an API body, or field errors.
 *
 * On edit only the fields that changed are sent. Re-sending an unchanged
 * `uomId` would be refused once the item has stock history, which would make
 * renaming an ingredient impossible.
 */
export function itemPayload(form, { original = null } = {}) {
  const errors = {};
  const next = {};

  const name = form.name.trim();
  if (name.length < 2) errors.name = "Enter a name.";
  else if (name.length > 120) errors.name = "Keep it under 120 characters.";
  next.name = name;

  const sku = form.sku.trim();
  if (sku.length > 40) errors.sku = "Keep it under 40 characters.";
  else if (sku && !/^[A-Za-z0-9._-]+$/.test(sku)) errors.sku = "Letters, numbers, dots, dashes and underscores only.";
  if (sku || original) next.sku = sku || undefined;

  next.type = form.type;
  next.categoryId = form.categoryId || null;
  if (!form.uomId) errors.uomId = "Choose the unit you count it in.";
  next.uomId = form.uomId;
  next.description = form.description.trim();
  next.barcode = form.barcode.trim() || null;
  next.costingMethod = form.costingMethod;
  next.isPerishable = Boolean(form.isPerishable);
  next.trackBatches = Boolean(form.trackBatches);

  const shelf = String(form.shelfLifeDays).trim();
  if (shelf) {
    const days = Number(shelf);
    if (!Number.isInteger(days) || days < 1 || days > 3650) errors.shelfLifeDays = "Enter whole days, 1 to 3650.";
    else next.shelfLifeDays = days;
  } else {
    next.shelfLifeDays = null;
  }
  if (next.isPerishable && !next.trackBatches && next.shelfLifeDays == null && !errors.shelfLifeDays) {
    errors.shelfLifeDays = "Something that goes off needs a shelf life, or batch tracking to record each delivery's date.";
  }

  for (const key of ["reorderLevel", "reorderQuantity"]) {
    const text = String(form[key]).trim();
    if (!text) {
      next[key] = null;
      continue;
    }
    const parsed = parseQuantity(text, { allowZero: true });
    if (parsed.error) errors[key] = parsed.error;
    else next[key] = parsed.value;
  }
  if (next.reorderQuantity != null && next.reorderLevel == null && !errors.reorderLevel) {
    errors.reorderLevel = "Set the level that triggers a reorder first.";
  }

  const yieldText = String(form.yieldPercent).trim() || "100";
  const yieldValue = Number(yieldText);
  if (!Number.isFinite(yieldValue) || yieldValue < 1 || yieldValue > 100) errors.yieldPercent = "Enter a percentage from 1 to 100.";
  else next.yieldPercent = yieldValue;

  if (Object.keys(errors).length) return { body: null, errors };

  if (!original) {
    const body = Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined && value !== null && value !== ""));
    return { body, errors };
  }

  const before = { ...itemFormValues(original) };
  const body = {};
  const same = (key, value) => {
    const was = before[key];
    if (typeof value === "boolean") return value === was;
    if (value === null) return was === "" || was === null;
    return String(value) === String(was);
  };
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) continue;
    if (key === "yieldPercent" ? Number(value) === Number(before.yieldPercent) : same(key, value)) continue;
    body[key] = value;
  }
  if (!Object.keys(body).length) return { body: null, errors: { form: "Nothing has changed." } };
  return { body, errors };
}

export function unitPayload(form) {
  const errors = {};
  const code = form.code.trim();
  if (!code) errors.code = "Enter a short code, e.g. kg.";
  else if (code.length > 12) errors.code = "Keep it to 12 characters.";
  const name = form.name.trim();
  if (!name) errors.name = "Enter a name, e.g. Kilogram.";

  const body = { code, name, type: form.type, precision: Number(form.precision) };
  if (!Number.isInteger(body.precision) || body.precision < 0 || body.precision > 6) errors.precision = "0 to 6 decimal places.";

  if (form.baseUnitId) {
    const factor = Number(String(form.factor).trim());
    if (!Number.isFinite(factor) || factor <= 0) errors.factor = "How many of the base unit make one of this?";
    else body.factor = factor;
    body.baseUnitId = form.baseUnitId;
  } else {
    body.baseUnitId = null;
  }
  return { body, errors };
}

export function locationPayload(form) {
  const errors = {};
  const name = form.name.trim();
  if (!name) errors.name = "Enter a name, e.g. Main store.";
  const code = form.code.trim().toUpperCase();
  if (!code) errors.code = "Enter a short code, e.g. MAIN.";
  else if (!/^[A-Z0-9_-]{1,20}$/.test(code)) errors.code = "Up to 20 letters, numbers, dashes or underscores.";
  return { body: { name, code, type: form.type, isDefault: Boolean(form.isDefault) }, errors };
}

/**
 * Adjustment lines → an API body. Each line says which way it goes rather
 * than asking for a signed number: "remove 3" is harder to get wrong than
 * "-3", and a missing minus sign adds stock that is not there.
 */
/**
 * An adjustment form, as the API wants it.
 *
 * Opening stock only adds, needs a cost on every line (the item's average is
 * nothing yet), and takes each item once. `isTracked(itemId)` says which items
 * arrive as batches, so their batch number and expiry are sent; a blank
 * expiry is left for the server to derive from shelf life.
 */
export function adjustmentPayload({ type = "CORRECTION", locationId, reason, lines, isTracked = () => false, today = null }) {
  const opening = type === "OPENING_STOCK";
  const errors = {};
  const lineErrors = {};
  if (!locationId) errors.locationId = "Choose where the stock is.";
  const why = String(reason ?? "").trim();
  if (why.length < 3) errors.reason = opening ? "Say what this is, e.g. the day you started counting." : "Say why — the approver has to judge it.";
  else if (why.length > 500) errors.reason = "Keep it under 500 characters.";

  const seen = new Set();
  const items = [];
  (lines ?? []).forEach((line, index) => {
    const problems = {};
    const adding = opening || line.direction !== "remove";
    if (!line.itemId) problems.itemId = "Choose an item.";
    else if (opening && seen.has(line.itemId)) problems.itemId = "This item is already on another line.";
    if (line.itemId) seen.add(line.itemId);
    const quantity = parseQuantity(line.quantity);
    if (quantity.error) problems.quantity = quantity.error;
    const cost = adding ? parseCost(line.unitCost, { optional: !opening }) : { value: undefined };
    if (cost.error) problems.unitCost = opening && cost.error === "Enter a cost." ? "Enter what it cost." : cost.error;
    else if (opening && !(cost.value > 0)) problems.unitCost = "Enter what it cost — more than zero.";

    const tracked = adding && line.itemId && isTracked(line.itemId);
    const batchNumber = tracked ? String(line.batchNumber ?? "").trim() : "";
    if (batchNumber.length > 60) problems.batchNumber = "Keep it under 60 characters.";
    const expiry = tracked ? String(line.expiryDate ?? "").trim() : "";
    if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) problems.expiryDate = "Enter a date.";
    else if (expiry && today && expiry < today) problems.expiryDate = "That date has passed — record it as waste instead.";

    if (Object.keys(problems).length) {
      lineErrors[index] = problems;
      return;
    }
    items.push({
      itemId: line.itemId,
      quantity: adding ? quantity.value : -quantity.value,
      ...(cost.value !== undefined ? { unitCost: cost.value } : {}),
      ...(line.note?.trim() ? { note: line.note.trim() } : {}),
      ...(batchNumber ? { batchNumber } : {}),
      ...(expiry ? { expiryDate: expiry } : {}),
    });
  });
  if (!lines?.length) errors.lines = "Add at least one item.";
  if (Object.keys(lineErrors).length) errors.lines = "Some lines need attention.";

  return { body: { locationId, type, reason: why, items }, errors, lineErrors };
}

export function wastagePayload(form) {
  const errors = {};
  if (!form.locationId) errors.locationId = "Choose where it was.";
  if (!form.itemId) errors.itemId = "Choose what was thrown away.";
  if (!form.reason) errors.reason = "Choose why.";
  const quantity = parseQuantity(form.quantity);
  if (quantity.error) errors.quantity = quantity.error;
  const notes = String(form.notes ?? "").trim();
  if (form.reason === "OTHER" && !notes) errors.notes = "Say what happened.";
  if (notes.length > 2000) errors.notes = "Keep it under 2000 characters.";
  return {
    body: {
      locationId: form.locationId,
      itemId: form.itemId,
      reason: form.reason,
      quantity: quantity.value,
      ...(notes ? { notes } : {}),
    },
    errors,
  };
}

export function transferPayload({ fromLocationId, toLocationId, notes, lines }) {
  const errors = {};
  const lineErrors = {};
  if (!fromLocationId) errors.fromLocationId = "Choose where it is leaving from.";
  if (!toLocationId) errors.toLocationId = "Choose where it is going.";
  else if (toLocationId === fromLocationId) errors.toLocationId = "Choose a different place to send it.";

  const items = [];
  (lines ?? []).forEach((line, index) => {
    const problems = {};
    if (!line.itemId) problems.itemId = "Choose an item.";
    const quantity = parseQuantity(line.quantity);
    if (quantity.error) problems.quantity = quantity.error;
    if (Object.keys(problems).length) lineErrors[index] = problems;
    else items.push({ itemId: line.itemId, quantitySent: quantity.value });
  });
  if (!lines?.length) errors.lines = "Add at least one item.";
  if (Object.keys(lineErrors).length) errors.lines = "Some lines need attention.";

  const note = String(notes ?? "").trim();
  return { body: { fromLocationId, toLocationId, items, ...(note ? { notes: note } : {}) }, errors, lineErrors };
}

/**
 * A count sheet → submitted lines. Every line must have a number: a blank is
 * not zero, and treating it as zero would post the item empty.
 */
export function countPayload(sheet, entries) {
  const lineErrors = {};
  const lines = [];
  for (const line of sheet) {
    const entry = entries[line.itemId] ?? {};
    const parsed = parseQuantity(entry.counted, { allowZero: true });
    if (parsed.error) {
      lineErrors[line.itemId] = String(entry.counted ?? "").trim() ? parsed.error : "Count it, or enter 0 if there is none.";
      continue;
    }
    lines.push({
      itemId: line.itemId,
      countedQuantity: parsed.value,
      ...(entry.reason?.trim() ? { reason: entry.reason.trim() } : {}),
    });
  }
  return { lines, lineErrors };
}
