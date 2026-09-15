/**
 * The delivery state machine.
 *
 * Pure, and separate from the service, because the rules that matter here are
 * about *sequence* — a driver cannot deliver food they never picked up, and a
 * delivery already handed over cannot be reassigned to someone else. Those are
 * properties of the graph, so they are tested against the graph rather than
 * discovered when a driver taps the wrong button on a dark street.
 *
 * The happy path:
 *
 *   PENDING -> ASSIGNED -> ACCEPTED -> ARRIVED_AT_STORE -> PICKED_UP
 *            -> ON_THE_WAY -> ARRIVED -> DELIVERED
 *
 * Every state before pickup can go back to PENDING, because an unaccepted or
 * rejected job simply returns to the pool. Nothing after PICKED_UP can: the
 * food is in someone's bag, and pretending otherwise loses track of it.
 */

export const DELIVERY_TRANSITIONS = {
  PENDING: ["ASSIGNED", "CANCELLED"],
  // A driver who has been offered a job may take it or turn it down.
  ASSIGNED: ["ACCEPTED", "REJECTED", "PENDING", "CANCELLED"],
  ACCEPTED: ["ARRIVED_AT_STORE", "PICKED_UP", "PENDING", "FAILED", "CANCELLED"],
  ARRIVED_AT_STORE: ["PICKED_UP", "PENDING", "FAILED", "CANCELLED"],
  // Once the food is in the bag the only ways out are delivery or failure.
  PICKED_UP: ["ON_THE_WAY", "ARRIVED", "DELIVERED", "FAILED"],
  ON_THE_WAY: ["ARRIVED", "DELIVERED", "FAILED"],
  ARRIVED: ["DELIVERED", "FAILED"],
  // A rejected offer goes back to the pool rather than ending the delivery.
  REJECTED: ["PENDING", "ASSIGNED", "CANCELLED"],
  DELIVERED: [],
  FAILED: ["PENDING", "ASSIGNED"],
  CANCELLED: [],
};

export const TERMINAL_DELIVERY_STATUSES = ["DELIVERED", "CANCELLED"];

/** States in which the driver is holding the customer's food. */
export const IN_POSSESSION = ["PICKED_UP", "ON_THE_WAY", "ARRIVED"];

/** States that occupy one of a driver's active-order slots. */
export const ACTIVE_STATUSES = [
  "ASSIGNED",
  "ACCEPTED",
  "ARRIVED_AT_STORE",
  "PICKED_UP",
  "ON_THE_WAY",
  "ARRIVED",
];

export function allowedDeliveryTransitions(from) {
  return DELIVERY_TRANSITIONS[from] ?? [];
}

export function canTransitionDelivery(from, to) {
  return allowedDeliveryTransitions(from).includes(to);
}

/**
 * Which delivery statuses drive the order's own status.
 *
 * The order and the delivery are two machines describing one journey, and they
 * must not be allowed to disagree — a customer watching "preparing" while the
 * driver is at their door is the kind of thing that generates a phone call.
 * Only these three transitions carry across; the rest are detail the order does
 * not need.
 */
export const ORDER_STATUS_FOR_DELIVERY = {
  PICKED_UP: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
};

/**
 * What a driver may do to their own delivery.
 *
 * Deliberately narrower than what dispatch may do. A driver can move their job
 * forward and report a failure; they cannot cancel an order, send a job back to
 * the pool after picking the food up, or assign themselves work.
 */
const DRIVER_ALLOWED = [
  "ACCEPTED",
  "REJECTED",
  "ARRIVED_AT_STORE",
  "PICKED_UP",
  "ON_THE_WAY",
  "ARRIVED",
  "DELIVERED",
  "FAILED",
];

export function driverMayTransition(from, to) {
  return DRIVER_ALLOWED.includes(to) && canTransitionDelivery(from, to);
}

/**
 * Whether a delivery still needs the handover code.
 *
 * Checked as its own question rather than folded into the transition rules,
 * because whether a code is required is a setting and whether the sequence is
 * legal is not.
 */
export function requiresHandoverCode({ status, otpHash, codeRequired }) {
  if (!codeRequired || !otpHash) return false;
  return status !== "DELIVERED";
}
