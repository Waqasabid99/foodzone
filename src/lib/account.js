/**
 * The customer's own screens, in their words rather than the kitchen's.
 *
 * `ORDER_STATES` already names every status for staff — "Cooking", "With the
 * rider". Those are right for a dashboard and wrong for the person waiting:
 * a customer does not want a status, they want to know whether anything is
 * expected of them. So this file answers a different question about the same
 * row — *is this finished, is it on its way, or does it need me?* — and the
 * account screens group by that.
 *
 * Nothing here is a second copy of the staff vocabulary: where the label is
 * the same, it is imported.
 */
import { ORDER_STATES, ORDER_TYPE_LABELS, PAYMENT_STATES } from "@/lib/order-status";

export { ORDER_STATES, ORDER_TYPE_LABELS, PAYMENT_STATES };

const CHIP = {
  good: "bg-success-container text-on-success-container",
  warn: "bg-warning-container text-on-warning-container",
  bad: "bg-error-container text-on-error-container",
  live: "bg-secondary-container text-on-secondary-container",
  quiet: "bg-surface-container-high text-on-surface-variant",
};

export const chipClass = (tone) => CHIP[tone] ?? CHIP.quiet;

// --- orders -----------------------------------------------------------------

/** Statuses where the order is still going to happen. */
const OPEN = new Set(["PENDING", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY"]);
/** Statuses where it is over, one way or another. */
const CLOSED = new Set(["DELIVERED", "COMPLETED", "CANCELLED", "REJECTED", "REFUNDED"]);

export const isOpenOrder = (order) => OPEN.has(order?.status);
export const isClosedOrder = (order) => CLOSED.has(order?.status);

/**
 * What the customer should understand about this order right now.
 *
 * Phrased from their side of the counter. "Preparing" is what the kitchen is
 * doing; "Being cooked now" is what is happening to their dinner.
 */
export function orderProgress(order) {
  switch (order?.status) {
    case "PENDING":
      return { label: "Waiting to be confirmed", tone: "warn", done: 1, of: 4 };
    case "CONFIRMED":
      return { label: "Confirmed", tone: "live", done: 2, of: 4 };
    case "PREPARING":
      return { label: "Being cooked now", tone: "live", done: 3, of: 4 };
    case "READY":
      return {
        label: order.type === "DELIVERY" ? "Ready, waiting for a rider" : "Ready to collect",
        tone: "live",
        done: 3,
        of: 4,
      };
    case "OUT_FOR_DELIVERY":
      return { label: "On the way to you", tone: "live", done: 4, of: 4 };
    case "DELIVERED":
    case "COMPLETED":
      return { label: "Finished", tone: "good", done: 4, of: 4 };
    case "CANCELLED":
      return { label: "Cancelled", tone: "quiet", done: 0, of: 4 };
    case "REJECTED":
      return { label: "The restaurant could not take it", tone: "bad", done: 0, of: 4 };
    case "REFUNDED":
      return { label: "Refunded", tone: "bad", done: 0, of: 4 };
    default:
      return { label: ORDER_STATES[order?.status]?.label ?? "Unknown", tone: "quiet", done: 0, of: 4 };
  }
}

/**
 * Whether anything is outstanding on the customer's side.
 *
 * The one thing worth surfacing above everything else: an unpaid order that
 * the restaurant is waiting on is not the same as an order simply in progress,
 * and burying it in a list of statuses is how it stays unpaid.
 */
export function needsAction(order) {
  if (!order) return null;
  if (order.paymentState === "FAILED") {
    return { label: "Payment failed", detail: "Try again, or pick another method.", action: "pay" };
  }
  if (order.paymentState === "UNPAID" && isOpenOrder(order)) {
    return { label: "Not paid yet", detail: "This order is waiting on payment.", action: "pay" };
  }
  return null;
}

/**
 * Whether the customer may still call this off themselves.
 *
 * The server is the authority — this only decides whether to offer the button.
 * Offering it on an order already in the pan produces a refusal the person
 * cannot do anything about.
 */
export const canCancel = (order) => order?.status === "PENDING" || order?.status === "CONFIRMED";

/** A one-line summary of what was ordered. */
export function itemSummary(order) {
  const count = order?._count?.items ?? order?.items?.length ?? 0;
  if (!count) return "No items";
  return `${count} ${count === 1 ? "item" : "items"}`;
}

export const ORDER_FILTERS = [
  { value: "", label: "All orders" },
  { value: "open", label: "In progress" },
  { value: "done", label: "Finished" },
];

/** The computed tabs cannot be a `where`, so the page narrows what came back. */
export function matchesFilter(order, filter) {
  if (!filter) return true;
  if (filter === "open") return isOpenOrder(order);
  if (filter === "done") return isClosedOrder(order);
  return true;
}

// --- addresses --------------------------------------------------------------

/** An address on one line, in the order an envelope would carry it. */
export function addressLine(address) {
  return [address?.line1, address?.line2, address?.landmark, address?.city, address?.state, address?.postalCode]
    .map((part) => (typeof part === "string" ? part.trim() : part))
    .filter(Boolean)
    .join(", ");
}

/**
 * What is missing before this address can take a delivery.
 *
 * A saved address that cannot be delivered to is worse than none: it is
 * chosen at checkout and fails there, when the person is trying to eat.
 */
/**
 * What is missing before this address can be saved.
 *
 * These are the server's own rules, not a friendlier subset: `addressSchema`
 * requires a state and a postal code, wants at least four characters of
 * street, and will not take a null label. A form that let any of those
 * through would fail on save, after the person had filled the whole thing in.
 * Held to the schema by a unit test.
 */
export function addressProblems(form) {
  const problems = [];
  const text = (value) => (typeof value === "string" ? value.trim() : "");

  if (text(form?.line1).length < 4) problems.push("The street address is needed.");
  if (!text(form?.city)) problems.push("The city is needed.");
  if (!text(form?.state)) problems.push("The state or province is needed.");
  if (text(form?.postalCode).length < 3) problems.push("A postal code is needed.");
  if (!text(form?.phone)) problems.push("A phone number is needed — riders call when they cannot find a door.");
  // Optional for the server, but an address nobody can be asked for is one a
  // rider gives up on, so the form asks. Two characters is the server's floor
  // when it is sent at all.
  if (text(form?.recipientName).length < 2) problems.push("Say who the rider should ask for.");
  return problems;
}

export function addressPayload(form) {
  const text = (value) => (typeof value === "string" ? value.trim() : "");
  const some = (value) => text(value) || null;
  return {
    // Omitted rather than nulled when blank: the column is not nullable and
    // the server fills in "Home" itself.
    ...(text(form.label) ? { label: text(form.label) } : {}),
    recipientName: text(form.recipientName),
    phone: text(form.phone),
    line1: text(form.line1),
    line2: some(form.line2),
    landmark: some(form.landmark),
    city: text(form.city),
    state: text(form.state),
    postalCode: text(form.postalCode),
    deliveryNote: some(form.deliveryNote),
  };
}

// --- reviews ----------------------------------------------------------------

export const REVIEW_STATES = {
  PENDING: { label: "Waiting to be published", tone: "warn", note: "A person reads every review before it goes up." },
  APPROVED: { label: "Published", tone: "good", note: "" },
  REJECTED: { label: "Not published", tone: "bad", note: "It did not meet the review guidelines." },
  HIDDEN: { label: "Hidden", tone: "quiet", note: "" },
};

export const reviewState = (review) =>
  REVIEW_STATES[review?.status] ?? { label: review?.status ?? "Unknown", tone: "quiet", note: "" };

export const STAR_LABELS = ["", "Poor", "Not great", "Fine", "Good", "Excellent"];

// --- notifications ----------------------------------------------------------

/** Unread first is the only ordering that makes a notification list useful. */
export const isUnread = (notification) => !notification?.readAt;

export function notificationTone(notification) {
  const type = String(notification?.type ?? "");
  if (/cancel|fail|reject|refund/i.test(type)) return "bad";
  if (/deliver|complete|approve|credit|paid/i.test(type)) return "good";
  return "quiet";
}

// --- devices ----------------------------------------------------------------

export const PLATFORM_LABELS = { IOS: "iPhone or iPad", ANDROID: "Android", WEB: "Browser" };

export const platformLabel = (platform) => PLATFORM_LABELS[platform] ?? platform ?? "Unknown device";

/**
 * A device nobody has used for a long time is the one worth removing, so it
 * is called out rather than left for the reader to work out from a date.
 */
export function deviceStaleness(device, now = new Date()) {
  if (!device?.lastSeenAt) return null;
  const days = Math.floor((now.getTime() - new Date(device.lastSeenAt).getTime()) / 86400000);
  if (days < 30) return null;
  return `Not used for ${days} days.`;
}
