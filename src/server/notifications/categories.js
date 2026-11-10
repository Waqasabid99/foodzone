/**
 * What a person may turn off, and what they may not.
 *
 * Preferences are expressed per **category**, never per notification type.
 * There are already a dozen types and there will be thirty; a screen with
 * thirty switches on it is one nobody reads, and a type added later would
 * silently default to "on" with no row anywhere admitting it. A category is a
 * promise about a kind of message, and new types join an existing one.
 *
 * Defined in code and stored in the database, for the reasons the settings
 * registry gives: a default means an unset preference still has a correct
 * answer everywhere, and a category cannot be invented at runtime by a client
 * posting a string.
 *
 * ## The rule that shapes all of it
 *
 * **The in-app row is the record. The push is the interruption.**
 *
 * So for anything transactional — your order, your payment, your delivery, a
 * shortage somebody has to act on — what a person may switch off is being
 * interrupted, not being told. The row is still written and still in their
 * list. An order that was cancelled and left no trace because a notification
 * setting was off is a support call nobody can answer, and for staff alerts it
 * is worse: a low-stock warning that was never recorded cannot be found
 * afterwards to explain why nothing was ordered.
 *
 * `marketing` is the exception and the reason the distinction exists at all.
 * An offer is not a record of anything, so opting out of it silences it
 * completely — and it is the one category that is off unless someone opts in,
 * which is what `notifications.marketing_optin_default` has always been for
 * and never been read by.
 *
 * ## Email is deliberately absent
 *
 * Nothing in the system sends a notification by email. `sendMail` is reached
 * only by verification, password reset and invitations — transactional
 * security mail that must not be switchable off by anybody, including its
 * recipient. An email toggle here would control nothing, and a preference that
 * controls nothing is worse than a missing one, because the first is believed.
 */

export const NOTIFICATION_CATEGORIES = [
  {
    key: "order",
    label: "Your orders",
    description: "Placed, confirmed, being cooked, ready, on its way, cancelled.",
    types: ["order.placed", "order.status_changed", "order.cancelled", "order.course_added"],
    /** The row is the record, so only the interruption can be switched off. */
    transactional: true,
    audience: "customer",
  },
  {
    key: "payment",
    label: "Payments and refunds",
    description: "When money is taken, and when it comes back.",
    types: ["payment.captured", "refund.completed"],
    transactional: true,
    audience: "customer",
  },
  {
    key: "delivery",
    label: "Delivery",
    description: "A driver is on the way, and when they arrive.",
    types: ["delivery.assigned", "delivery.status_changed"],
    transactional: true,
    audience: "customer",
  },
  {
    key: "creator",
    label: "Your videos",
    description: "Whether a video was published, and what it earned.",
    types: ["creator.video_published", "creator.video_rejected"],
    transactional: true,
    audience: "creator",
  },
  {
    key: "operations",
    label: "Things needing attention",
    description: "Low stock, a table asking for the bill, an accounting period running out.",
    types: ["inventory.low_stock", "order.bill_requested", "finance.fiscal_runway"],
    /*
     * Transactional for staff, and the stricter case: an alert nobody can find
     * afterwards is how "why did we run out?" becomes unanswerable. The push
     * can be silenced by whoever does not want their phone going off; the
     * record cannot.
     */
    transactional: true,
    audience: "staff",
    /*
     * What it takes to be able to receive one of these at all.
     *
     * Listed so the screen can leave the category out rather than offering a
     * customer a switch for "low stock" — which teaches them this screen is
     * not really about them, and that the rest of it is not worth reading.
     * These are the grants the producers actually notify: the low-stock alert
     * goes to whoever can raise a purchase order, the bill request to whoever
     * can take money, the runway warning to whoever can open a period.
     */
    requiresAny: ["purchase_orders.create", "payments.capture", "accounting.manage_periods"],
  },
  {
    key: "marketing",
    label: "Offers and news",
    description: "Promotions, new dishes, and anything else we think you would like.",
    types: ["marketing.campaign"],
    /** Not a record of anything, so opting out silences it entirely. */
    transactional: false,
    audience: "customer",
  },
];

const BY_KEY = new Map(NOTIFICATION_CATEGORIES.map((category) => [category.key, category]));

const BY_TYPE = new Map(
  NOTIFICATION_CATEGORIES.flatMap((category) => category.types.map((type) => [type, category])),
);

export const CATEGORY_KEYS = NOTIFICATION_CATEGORIES.map((category) => category.key);

export function notificationCategory(key) {
  return BY_KEY.get(key) ?? null;
}

/**
 * Which category a notification type belongs to.
 *
 * Returns null for a type no category claims, and the callers treat that as
 * "send it". An unclassified notification is a gap in this file, and the right
 * behaviour for a gap is to deliver the message and let somebody notice it on
 * the screen — not to swallow it silently because a registry entry was
 * forgotten.
 */
export function categoryForType(type) {
  return BY_TYPE.get(type) ?? null;
}

/** Every type the registry claims, for the test that checks none have been missed. */
export function classifiedTypes() {
  return [...BY_TYPE.keys()];
}
