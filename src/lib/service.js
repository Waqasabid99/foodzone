import { ORDER_STATES, ORDER_TYPE_LABELS, PAYMENT_STATES } from "@/lib/order-status";
import { addAmounts, compare, decimal, difference, exceeds, unscale } from "@/lib/money-math";

export { ORDER_STATES, ORDER_TYPE_LABELS, PAYMENT_STATES };

/**
 * Words and form rules for the Service screens — the counter, the kitchen,
 * the dining room and the baskets in progress.
 *
 * Pure, so the rule a form enforces before sending sits beside the sentence it
 * shows when the rule is broken. The server checks all of it again.
 *
 * The thing that runs through this whole section is **time**. Every other part
 * of the system is read at a desk; this one is read standing up, by somebody
 * holding a card machine with a queue behind them. So the words are short, the
 * next action is always the obvious one, and nothing asks a question that the
 * screen could have answered itself.
 */

// --- orders -----------------------------------------------------------------

export const ORDER_CHANNELS = {
  WEB: "Website",
  APP: "App",
  POS: "Counter",
  PHONE: "Phone",
  KIOSK: "Kiosk",
  THIRD_PARTY: "Delivery app",
};

export const channelLabel = (channel) => ORDER_CHANNELS[channel] ?? channel;

/**
 * What pressing each button actually does, in the words of the person pressing
 * it.
 *
 * The verb matters more than it looks. "Confirm" and "Start cooking" are two
 * different promises to a customer — the first says we have the order, the
 * second says food is being made and cancelling now wastes it — and a screen
 * that calls both of them "Next" makes that distinction invisible.
 *
 * `done` is what the confirmation says afterwards, written out rather than
 * derived. Adding "d" to the lower-cased verb works for exactly one of these
 * ten — "Accept" — and produced "close the orderd" for the rest.
 */
export const STATUS_ACTIONS = {
  CONFIRMED: { verb: "Accept", done: "accepted", hint: "Tells the customer the order is on. It appears in the kitchen next." },
  PREPARING: { verb: "Start cooking", done: "is in the kitchen", hint: "Food is being made. Cancelling after this wastes it." },
  READY: { verb: "Mark ready", done: "is ready", hint: "Waiting to be collected, served or picked up by a rider." },
  OUT_FOR_DELIVERY: { verb: "Hand to rider", done: "is with the rider", hint: "On its way. The customer can track it from here." },
  DELIVERED: { verb: "Mark delivered", done: "was delivered", hint: "It reached the customer." },
  COMPLETED: { verb: "Close the order", done: "is closed", hint: "Done and settled. Nothing more happens to it." },
  CANCELLED: { verb: "Cancel", done: "was cancelled", hint: "Called off. Anything already paid has to be refunded separately." },
  REJECTED: { verb: "Reject", done: "was rejected", hint: "Turned down before it was accepted — out of stock, too far, closed." },
  REFUNDED: { verb: "Refund", done: "was refunded", hint: "Money goes back. Recorded against the order." },
  PENDING: { verb: "Send it through", done: "is in the queue", hint: "Puts the draft into the queue as a live order." },
};

export const statusAction = (status) => STATUS_ACTIONS[status] ?? { verb: status, done: status.toLowerCase(), hint: null };

/** Statuses after which nothing more happens — mirrors the server's list. */
export const TERMINAL_STATUSES = ["COMPLETED", "CANCELLED", "REJECTED", "REFUNDED"];
export const isTerminal = (status) => TERMINAL_STATUSES.includes(status);

/** Statuses that mean a refusal rather than a step forward. */
export const REFUSALS = ["CANCELLED", "REJECTED"];

/** The tabs over the orders list, in the order a shift actually works them. */
export const ORDER_FILTERS = [
  { value: "", label: "All" },
  { value: "PENDING", label: "New" },
  { value: "CONFIRMED", label: "Accepted" },
  { value: "PREPARING", label: "Cooking" },
  { value: "READY", label: "Ready" },
  { value: "OUT_FOR_DELIVERY", label: "With rider" },
  { value: "COMPLETED", label: "Done" },
];

/**
 * How long an order has been sitting, in the words somebody chasing it uses.
 *
 * Whole minutes, counted from a timestamp rather than a date, because the
 * question on this screen is always "how long has this been waiting?" and the
 * answer "3 minutes" is actionable where "today at 14:32" is arithmetic.
 */
export function waitingFor(since, { now = new Date() } = {}) {
  if (!since) return { label: "—", minutes: null, tone: "text-on-surface-variant" };
  const minutes = Math.floor((now.getTime() - new Date(since).getTime()) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 0) return { label: "just now", minutes: 0, tone: "text-on-surface-variant" };

  const label =
    minutes < 1
      ? "just now"
      : minutes < 60
        ? `${minutes} min`
        : minutes < 1440
          ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
          : `${Math.floor(minutes / 1440)}d`;

  // A late order is not an error, so it is not an error colour until it really
  // is one: twenty minutes is a slow kitchen, forty-five is a complaint.
  const tone = minutes >= 45 ? "text-error" : minutes >= 20 ? "text-warning" : "text-on-surface-variant";
  return { label, minutes, tone };
}

/**
 * What is still owed, given what has actually been captured.
 *
 * `paid` is passed in rather than read off the order, because `Order.paidTotal`
 * is a column **nothing ever writes** — it sits at zero however much has been
 * taken. Reading it would make every order look unpaid, so the page works the
 * figure out from the payment rows with the server's own `amountDue` and hands
 * the answer down.
 */
export const owedAfter = (grandTotal, paid) => difference(grandTotal ?? 0, paid ?? 0);

export const isSettled = (grandTotal, paid) => compare(decimal(owedAfter(grandTotal, paid)), decimal(0)) <= 0;

// --- taking money -----------------------------------------------------------

export const PAYMENT_METHODS = {
  CASH: { label: "Cash", takesTender: true },
  CARD: { label: "Card", takesTender: false },
  WALLET: { label: "Wallet", takesTender: false },
  BANK_TRANSFER: { label: "Bank transfer", takesTender: false },
  COD: { label: "Cash on delivery", takesTender: false },
};

export const methodLabel = (method) => PAYMENT_METHODS[method]?.label ?? method;

/**
 * Change for a cash sale.
 *
 * Worked out on exact decimals rather than floats, because this number is
 * counted out of a drawer into somebody's hand. A float rounding error here is
 * not a display bug, it is a coin.
 *
 * A tender below the amount due is not change, it is a short payment — the
 * caller is told which it is rather than being handed a negative number to
 * interpret.
 */
export function changeDue(tender, due) {
  const given = decimal(tender);
  const owed = decimal(due);
  if (compare(given, owed) < 0) {
    return { short: true, change: "0.00", shortfall: difference(due, tender) };
  }
  return { short: false, change: difference(tender, due), shortfall: "0.00" };
}

/**
 * A payment, as the till form holds it.
 *
 * `amount` is what is charged to the order; a cash tender larger than that is
 * change, never an overpayment. Overpaying is refused here as well as on the
 * server because the till is exactly where somebody types 5000 meaning 500.
 *
 * `orderId` is what the money is being taken against, and the endpoint will not
 * accept a payment without one. It is asserted in the tests over `body` rather
 * than over `errors` alone: a payload that validates cleanly and is still
 * refused by the server is the shape of mistake a form test does not see.
 */
export function paymentPayload(form, { outstanding = null } = {}) {
  const errors = {};
  const method = form.method;
  if (!PAYMENT_METHODS[method]) errors.method = "Choose how they are paying.";
  if (!form.orderId) errors.orderId = "There is no order to take this against.";

  const amount = String(form.amount ?? "").trim();
  if (!amount) errors.amount = "Enter the amount.";
  else if (!/^\d+(\.\d{1,2})?$/.test(amount.replace(/,/g, ""))) errors.amount = "Enter an amount, e.g. 450 or 450.50";
  else if (compare(decimal(amount), decimal(0)) <= 0) errors.amount = "A payment has to be for something.";
  else if (outstanding != null && exceeds(amount, outstanding)) {
    errors.amount = `Only ${unscale(decimal(outstanding))} is still owed on this order.`;
  }

  if (PAYMENT_METHODS[method]?.takesTender && String(form.tender ?? "").trim()) {
    if (changeDue(form.tender, amount).short) errors.tender = "That is less than the amount being charged.";
  }

  return {
    body: {
      orderId: form.orderId,
      method,
      amount: Number(String(amount).replace(/,/g, "")),
      ...(form.registerSessionId ? { registerSessionId: form.registerSessionId } : {}),
      ...(form.idempotencyKey ? { idempotencyKey: form.idempotencyKey } : {}),
    },
    errors,
  };
}

// --- the front desk ---------------------------------------------------------

/**
 * Whether the counter takes the money before the order fires.
 *
 * Collection does: the customer pays, takes the bag and leaves, and there is
 * no second chance to charge them. Dine-in does not — the bill is settled at
 * the table, which is also the only way a second round can join it. Delivery
 * does not either: it is paid online or handed to the rider at the door.
 *
 * One function rather than a condition written out at each call site, because
 * the counter screen, its submit button and its wording all have to agree.
 */
export function paysUpFront(type) {
  return type === "PICKUP";
}

/** Order types a counter can actually take, with what each one then needs. */
export const COUNTER_TYPES = [
  { value: "DINE_IN", label: "Dine in", needs: "a table" },
  { value: "PICKUP", label: "Collection", needs: null },
  { value: "DELIVERY", label: "Delivery", needs: "a saved address" },
];

/**
 * A basket on the counter screen, turned into what the orders endpoint wants.
 *
 * Deliberately sends only ids and quantities. What anything *costs* is never
 * sent from here: the server prices the order from the live menu, so a stale
 * screen or a tampered request cannot sell a steak for nothing.
 */
/**
 * Every sellable line on a counter's menu, flattened for searching.
 *
 * **Both spellings of an id are accepted.** A branch menu names a product
 * `productId` and a variant `variantId`; the catalogue read names them `id`.
 * The screen is fed from whichever is cheaper, and reading only one of them
 * sent every line to the server with no product on it — the counter answered
 * "Invalid request body" for every order anybody tried to take, which is the
 * one failure that cannot be worked around from the till.
 */
export function counterCatalogue(menu) {
  const rows = [];

  for (const section of menu?.sections ?? []) {
    for (const product of section.products ?? []) {
      const productId = product.productId ?? product.id;

      for (const variant of product.variants ?? []) {
        const variantId = variant.variantId ?? variant.id;
        rows.push({
          key: variantId ?? `${productId}-${variant.name}`,
          section: section.name,
          productId,
          slug: product.slug,
          name: product.name,
          variantId,
          variantName: variant.name,
          price: variant.price,
          available: variant.available !== false,
          // A combo always has something to choose, even when this read did
          // not carry its slots.
          hasOptions: Boolean(product.hasModifiers ?? product.modifierGroups?.length ?? product.type === "COMBO"),
        });
      }
    }
  }

  return rows;
}

export function counterOrderPayload({ branchId, type, lines, customer, tableId, guestCount, notes, kitchenNote, couponCode, tipAmount }) {
  const errors = {};
  if (!branchId) errors.branchId = "Choose which branch is serving this.";
  if (!type) errors.type = "Dine in, collection or delivery?";
  if (type === "DINE_IN" && !tableId) errors.tableId = "Which table?";

  const items = (lines ?? []).map((line) => ({
    productId: line.productId,
    ...(line.variantId ? { variantId: line.variantId } : {}),
    quantity: line.quantity,
    modifiers: line.modifiers ?? [],
    comboSelections: line.comboSelections ?? [],
  }));
  if (!items.length) errors.items = "The basket is empty.";

  const guestName = String(customer?.name ?? "").trim();
  const guestPhone = String(customer?.phone ?? "").trim();

  // A delivery has to reach somebody, so it needs an account with an address —
  // a walk-in name and phone is not something a rider can navigate to.
  if (type === "DELIVERY" && !customer?.userId) {
    errors.customer = "A delivery needs a customer account with a saved address.";
  }
  if (type === "DELIVERY" && customer?.userId && !customer?.addressId) {
    errors.addressId = "Choose which of their addresses it is going to.";
  }
  /*
   * A collection order with nobody's name on it cannot be called out. Dine-in
   * is the exception: the table names it, which is what the server checks too.
   */
  if (type !== "DELIVERY" && !customer?.userId && !guestName && !(type === "DINE_IN" && tableId)) {
    errors.customer = "A name, so the order can be called out.";
  }

  const tip = String(tipAmount ?? "").trim();
  if (tip && !/^\d+(\.\d{1,2})?$/.test(tip)) errors.tipAmount = "Enter an amount, e.g. 200";

  return {
    body: {
      branchId,
      type,
      channel: "POS",
      items,
      ...(customer?.userId ? { userId: customer.userId } : {}),
      ...(customer?.userId && customer?.addressId ? { addressId: customer.addressId } : {}),
      ...(!customer?.userId && guestName ? { guest: { name: guestName, ...(guestPhone ? { phone: guestPhone } : {}) } } : {}),
      ...(tableId ? { tableId } : {}),
      ...(guestCount ? { guestCount: Number(guestCount) } : {}),
      customerNote: String(notes ?? "").trim() || null,
      kitchenNote: String(kitchenNote ?? "").trim() || null,
      ...(tip ? { tipAmount: Number(tip) } : {}),
      ...(String(couponCode ?? "").trim() ? { couponCode: String(couponCode).trim().toUpperCase() } : {}),
    },
    errors,
  };
}

/** A rough basket total for the counter, before the server prices it properly. */
export function basketPreview(lines = []) {
  return addAmounts(
    ...lines.map((line) => {
      const extras = (line.modifierPrices ?? []).reduce((sum, price) => addAmounts(sum, price), "0.00");
      const each = addAmounts(line.unitPrice ?? 0, extras);
      // Quantity is a small integer, so repeated addition stays exact and
      // avoids a multiply that would need its own rounding rule.
      return addAmounts(...Array.from({ length: Math.max(0, line.quantity ?? 0) }, () => each));
    }),
  );
}

// --- the kitchen ------------------------------------------------------------

export const ITEM_STATES = {
  QUEUED: { label: "Waiting", tone: "bg-surface-container-high text-on-surface-variant" },
  PREPARING: { label: "On", tone: "bg-warning-container text-on-warning-container" },
  READY: { label: "Ready", tone: "bg-success-container text-on-success-container" },
  SERVED: { label: "Served", tone: "bg-surface-container-high text-on-surface-variant" },
  CANCELLED: { label: "Cancelled", tone: "bg-error-container text-on-error-container" },
};

/**
 * The four reasons a kitchen takes a ticket off its board.
 *
 * Presets rather than a text box alone because this is a wall-mounted screen
 * operated with the side of a thumb, and because the till reads these: a fixed
 * set is something the next person recognises at a glance. Anything else is
 * still typed, which is the rare case.
 */
export const SET_ASIDE_REASONS = [
  "Nobody collected it",
  "Duplicate ticket",
  "We cannot make this",
  "Customer sent it back",
];

/** What a kitchen hand presses next on a ticket line. */
export const ITEM_NEXT = { QUEUED: "PREPARING", PREPARING: "READY", READY: "SERVED" };

/**
 * What the button on a line says, as an instruction.
 *
 * The board used the *status* labels above for the button too, so the control
 * that moves a line to READY was captioned "Ready" — sitting on the same
 * screen as a finished line whose chip also said "Ready". One word, two
 * opposite meanings, read at speed by somebody holding a pan. The order screen
 * already keeps its verbs apart from its states; this is the same separation
 * for the kitchen.
 */
export const ITEM_ACTIONS = {
  PREPARING: "Start it",
  READY: "It's ready",
  SERVED: "Hand it over",
};

export const itemAction = (status) => ITEM_ACTIONS[status] ?? status;

/**
 * How hard a ticket is shouting.
 *
 * A kitchen display is read from several feet away by somebody holding a pan,
 * so age is a band rather than a number: fine, getting on, and late. The bands
 * are deliberately generous — a screen that cries wolf at four minutes is one
 * the kitchen learns to ignore, and then it is useless at forty.
 */
export function ticketUrgency(placedAt, { now = new Date(), warnAfter = 12, lateAfter = 25 } = {}) {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(placedAt).getTime()) / 60_000));
  if (minutes >= lateAfter) return { level: "late", minutes, tone: "border-error bg-error-container text-on-error-container" };
  if (minutes >= warnAfter) return { level: "ageing", minutes, tone: "border-warning bg-warning-container text-on-warning-container" };
  return { level: "fresh", minutes, tone: "border-outline-variant bg-surface-container-lowest text-on-surface" };
}

/** How often the kitchen screen re-asks. Seconds, because a kitchen is a live place. */
export const KITCHEN_POLL_SECONDS = 10;

// --- tables -----------------------------------------------------------------

export function tablePayload(form, { isNew = true } = {}) {
  const errors = {};
  const name = String(form.name ?? "").trim();
  if (!name) errors.name = "Give the table a name — T-4, Window 2, Terrace A.";
  else if (name.length > 40) errors.name = "That name is too long.";

  const seats = form.seats === "" || form.seats == null ? null : Number(form.seats);
  if (seats == null) errors.seats = "How many people fit?";
  else if (!Number.isInteger(seats) || seats < 1 || seats > 100) errors.seats = "Seats are a whole number from 1 to 100.";

  if (isNew && !form.branchId) errors.branchId = "Which branch is this table in?";

  return {
    body: {
      ...(isNew ? { branchId: form.branchId } : {}),
      name,
      area: String(form.area ?? "").trim() || null,
      ...(seats != null ? { seats } : {}),
      isActive: form.isActive !== false,
    },
    errors,
  };
}

/**
 * Laying out a room in one go.
 *
 * Capped at 200 by the server, and the form says so before the submit rather
 * than after: a mistyped `to` of 20000 is a typo that is tedious to undo, and
 * finding that out from a rejected request is a worse way to learn it.
 */
export function bulkTablePayload(form) {
  const errors = {};
  if (!form.branchId) errors.branchId = "Which branch?";

  const from = Number(form.from);
  const to = Number(form.to);
  if (!Number.isInteger(from) || from < 0) errors.from = "Start at a whole number.";
  if (!Number.isInteger(to) || to < 0) errors.to = "End at a whole number.";
  else if (Number.isInteger(from) && to < from) errors.to = "The range runs backwards.";
  else if (Number.isInteger(from) && to - from >= 200) errors.to = "Create at most 200 tables at a time.";

  const seats = Number(form.seats || 4);
  if (!Number.isInteger(seats) || seats < 1 || seats > 100) errors.seats = "Seats are a whole number from 1 to 100.";

  const padTo = form.padTo === "" || form.padTo == null ? null : Number(form.padTo);
  if (padTo != null && (!Number.isInteger(padTo) || padTo < 1 || padTo > 6)) errors.padTo = "Pad to between 1 and 6 digits.";

  return {
    body: {
      branchId: form.branchId,
      prefix: String(form.prefix ?? "T-"),
      from,
      to,
      seats,
      ...(padTo != null ? { padTo } : {}),
      area: String(form.area ?? "").trim() || null,
    },
    errors,
  };
}

/** What the bulk form is about to create, so it can be read before it is done. */
export function bulkTablePreview({ prefix = "T-", from, to, padTo = null }) {
  const start = Number(from);
  const end = Number(to);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) return { count: 0, sample: [] };

  const name = (n) => `${prefix}${padTo ? String(n).padStart(padTo, "0") : n}`;
  const count = end - start + 1;
  const sample = count <= 4 ? Array.from({ length: count }, (_, i) => name(start + i)) : [name(start), name(start + 1), "…", name(end)];
  return { count, sample };
}

// --- QR codes ---------------------------------------------------------------

export const QR_TARGETS = {
  MENU: { label: "The menu", hint: "Opens the branch's menu. The ordinary poster or table-talker." },
  TABLE: { label: "A table", hint: "Opens the menu already knowing which table it is — orders arrive tagged." },
  CATEGORY: { label: "A category", hint: "Straight to one part of the menu, for a counter display." },
  PRODUCT: { label: "One item", hint: "Straight to a single dish." },
  CUSTOM_URL: { label: "Somewhere else", hint: "A feedback form, a social profile. Must be an http or https address." },
};

export function qrPayload(form, { isNew = true } = {}) {
  const errors = {};
  if (isNew && !form.branchId) errors.branchId = "Which branch is this code for?";
  if (!QR_TARGETS[form.targetType]) errors.targetType = "What should scanning it open?";

  if (form.targetType === "TABLE" && !form.tableId) errors.tableId = "Choose the table.";
  if (form.targetType === "CATEGORY" && !form.categoryId) errors.categoryId = "Choose the category.";
  if (form.targetType === "PRODUCT" && !form.productId) errors.productId = "Choose the item.";

  const url = String(form.customUrl ?? "").trim();
  if (form.targetType === "CUSTOM_URL") {
    if (!url) errors.customUrl = "Where should it go?";
    else if (!/^https?:\/\//i.test(url)) errors.customUrl = "Use an http or https address.";
  }

  // Only the field this target actually uses is sent. Leaving a stale tableId
  // on a code that now points at the menu is how a sticker starts seating
  // people at a table that was deleted.
  return {
    body: {
      ...(isNew ? { branchId: form.branchId } : {}),
      targetType: form.targetType,
      menuId: form.targetType === "MENU" ? form.menuId || null : null,
      tableId: form.targetType === "TABLE" ? form.tableId : null,
      categoryId: form.targetType === "CATEGORY" ? form.categoryId : null,
      productId: form.targetType === "PRODUCT" ? form.productId : null,
      customUrl: form.targetType === "CUSTOM_URL" ? url : null,
      label: String(form.label ?? "").trim() || null,
      isActive: form.isActive !== false,
    },
    errors,
  };
}

/** What a code points at, in one line, for a list. */
export function qrTargetSummary(qr) {
  if (!qr) return "—";
  switch (qr.targetType) {
    case "TABLE":
      return qr.table?.name ? `Table ${qr.table.name}` : "A table that no longer exists";
    case "CATEGORY":
      return qr.category?.name ?? "A category that no longer exists";
    case "PRODUCT":
      return qr.product?.name ?? "An item that no longer exists";
    case "CUSTOM_URL":
      return qr.customUrl ?? "A link that is no longer set";
    default:
      return qr.menu?.name ? `Menu: ${qr.menu.name}` : "The branch menu";
  }
}

// --- live carts -------------------------------------------------------------

/**
 * How long a basket has been untouched, and whether that means anything yet.
 *
 * A cart two minutes old is somebody shopping. One forty minutes old is
 * somebody who gave up, and that is the only one worth ringing about — so the
 * wording changes at the point where the cart stops being a customer and
 * starts being a lost sale.
 */
export function cartState(cart, { now = new Date(), staleAfter = 30 } = {}) {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(cart?.updatedAt ?? now).getTime()) / 60_000));
  if (minutes < 3) return { label: "Shopping now", minutes, tone: "bg-success-container text-on-success-container" };
  if (minutes < staleAfter) return { label: `Idle ${minutes} min`, minutes, tone: "bg-surface-container-high text-on-surface-variant" };
  const hours = Math.floor(minutes / 60);
  return {
    label: hours ? `Abandoned ${hours}h ago` : `Abandoned ${minutes} min ago`,
    minutes,
    tone: "bg-warning-container text-on-warning-container",
  };
}

/** Who the basket belongs to, as a support screen would say it. */
export const cartOwner = (cart) =>
  cart?.user?.name || cart?.user?.email || (cart?.userId ? "A signed-in customer" : "A guest, not signed in");
