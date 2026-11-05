import { addAmounts, compare, decimal, minusAmounts } from "@/lib/money-math";

/**
 * Words and form rules for the Delivery screens — dispatch, the drivers and
 * what they are owed.
 *
 * Pure, so the rule a form enforces before sending sits beside the sentence it
 * shows when the rule is broken. The server checks all of it again.
 *
 * Two ideas run through the whole section.
 *
 * **A delivery is a job, not a status.** It exists because somebody has to
 * carry food to a door, and the only questions that matter are who is carrying
 * it, where they are in the journey, and whether the customer has it. Every
 * screen here is arranged around those three.
 *
 * **Cash in a driver's bag is a debt.** COD collected is the restaurant's
 * money sitting in somebody's pocket until the end of the shift. That is said
 * plainly wherever the number appears, because a figure labelled "collected"
 * reads like income and it is not.
 */

// --- deliveries -------------------------------------------------------------

export const DELIVERY_STATES = {
  PENDING: { label: "Waiting for a driver", tone: "bg-warning-container text-on-warning-container" },
  ASSIGNED: { label: "Offered", tone: "bg-secondary-container text-on-secondary-container" },
  ACCEPTED: { label: "Accepted", tone: "bg-secondary-container text-on-secondary-container" },
  REJECTED: { label: "Turned down", tone: "bg-error-container text-on-error-container" },
  ARRIVED_AT_STORE: { label: "At the counter", tone: "bg-secondary-container text-on-secondary-container" },
  PICKED_UP: { label: "Collected", tone: "bg-secondary-container text-on-secondary-container" },
  ON_THE_WAY: { label: "On the way", tone: "bg-secondary-container text-on-secondary-container" },
  ARRIVED: { label: "At the door", tone: "bg-secondary-container text-on-secondary-container" },
  DELIVERED: { label: "Delivered", tone: "bg-success-container text-on-success-container" },
  FAILED: { label: "Failed", tone: "bg-error-container text-on-error-container" },
  CANCELLED: { label: "Cancelled", tone: "bg-surface-container-high text-on-surface-variant" },
};

/** What pressing each button actually does, in the words of the person pressing it. */
export const DELIVERY_ACTIONS = {
  ASSIGNED: { verb: "Offer", hint: "Sends the job to that driver. They still have to accept it." },
  ACCEPTED: { verb: "Accept for them", hint: "Records that the driver has taken the job." },
  REJECTED: { verb: "Turned down", hint: "Back to the pool for somebody else to take." },
  ARRIVED_AT_STORE: { verb: "At the counter", hint: "The driver is here, waiting for the bag." },
  PICKED_UP: { verb: "Handed over", hint: "The food is in the driver's bag. From here it can only be delivered or fail." },
  ON_THE_WAY: { verb: "On the way", hint: "Riding to the customer. They can track it from here." },
  ARRIVED: { verb: "At the door", hint: "The driver is outside the customer's address." },
  DELIVERED: { verb: "Delivered", hint: "The customer has their food. This closes the job." },
  FAILED: { verb: "Mark failed", hint: "Nobody answered, wrong address, refused. Needs a reason." },
  CANCELLED: { verb: "Cancel", hint: "Called off before anybody carried it." },
  PENDING: { verb: "Back to the pool", hint: "Unassigns it so another driver can take it." },
};

export const deliveryAction = (status) => DELIVERY_ACTIONS[status] ?? { verb: status, hint: null };

/** The journey, in order, for a progress line somebody reads at a glance. */
export const DELIVERY_JOURNEY = ["PENDING", "ASSIGNED", "ACCEPTED", "PICKED_UP", "ON_THE_WAY", "ARRIVED", "DELIVERED"];

/** States in which the driver is holding the customer's food. Mirrors the server. */
export const IN_POSSESSION = ["PICKED_UP", "ON_THE_WAY", "ARRIVED"];

export const TERMINAL_DELIVERY_STATUSES = ["DELIVERED", "CANCELLED"];

export const isDeliveryOver = (status) => TERMINAL_DELIVERY_STATUSES.includes(status) || status === "FAILED";

/**
 * Whether a job can still be taken off one driver and given to another.
 *
 * Refused once the food is in the bag. Reassigning then does not move the
 * food — it just makes the system disagree with the street about who has it,
 * and the customer's dinner is somewhere neither of them is looking.
 */
export const canReassign = (delivery) =>
  Boolean(delivery?.driverId) && !IN_POSSESSION.includes(delivery?.status) && !isDeliveryOver(delivery?.status);

export const DELIVERY_FILTERS = [
  { value: "", label: "All" },
  { value: "PENDING", label: "Unassigned" },
  { value: "ASSIGNED", label: "Offered" },
  { value: "PICKED_UP", label: "Collected" },
  { value: "ON_THE_WAY", label: "On the way" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "FAILED", label: "Failed" },
];

/**
 * How long a job has been waiting, in the words somebody chasing it uses.
 *
 * A delivery nobody has picked up is the one number a dispatcher is really
 * watching, so it escalates sooner than an order in a kitchen does: food goes
 * cold on a counter while a rider is found.
 */
export function waitingSince(since, { now = new Date(), warnAfter = 8, lateAfter = 20 } = {}) {
  if (!since) return { label: "—", minutes: null, tone: "text-on-surface-variant" };
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 60_000));
  const label = minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  const tone = minutes >= lateAfter ? "text-error" : minutes >= warnAfter ? "text-warning" : "text-on-surface-variant";
  return { label, minutes, tone };
}

// --- drivers ----------------------------------------------------------------

export const DRIVER_STATES = {
  AVAILABLE: { label: "Free", tone: "bg-success-container text-on-success-container", canTake: true },
  ON_DELIVERY: { label: "Out on a job", tone: "bg-secondary-container text-on-secondary-container", canTake: true },
  ON_BREAK: { label: "On a break", tone: "bg-warning-container text-on-warning-container", canTake: false },
  OFFLINE: { label: "Off shift", tone: "bg-surface-container-high text-on-surface-variant", canTake: false },
  SUSPENDED: { label: "Suspended", tone: "bg-error-container text-on-error-container", canTake: false },
};

export const VEHICLES = {
  BICYCLE: "Bicycle",
  MOTORCYCLE: "Motorbike",
  SCOOTER: "Scooter",
  CAR: "Car",
  VAN: "Van",
  ON_FOOT: "On foot",
};

export const vehicleLabel = (type) => VEHICLES[type] ?? type;

/** Whether this driver can be offered another job right now, and why not. */
export function availability(driver) {
  const state = DRIVER_STATES[driver?.status];
  if (!driver?.isActive) return { canTake: false, reason: "Not an active driver" };
  if (!state?.canTake) return { canTake: false, reason: state?.label ?? "Unavailable" };

  const active = driver.activeDeliveries ?? 0;
  const max = driver.maxActiveOrders ?? 1;
  if (active >= max) return { canTake: false, reason: `Already carrying ${active}`, active, max };
  return { canTake: true, reason: null, active, max };
}

/**
 * How long ago a driver's phone last reported where it was.
 *
 * The honest framing for a dispatcher: not "where they are" but "when we last
 * heard". A position twenty minutes old is not a location, it is a guess, and
 * a board that presents it as a location sends somebody to the wrong street.
 */
export function lastSeen(at, { now = new Date(), staleAfter = 5 } = {}) {
  if (!at) return { label: "Never reported", minutes: null, stale: true, tone: "text-on-surface-variant" };
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(at).getTime()) / 60_000));
  const stale = minutes >= staleAfter;
  const label = minutes < 1 ? "Just now" : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)}h ago`;
  return { label, minutes, stale, tone: stale ? "text-warning" : "text-on-surface-variant" };
}

const trimmed = (value) => {
  const text = String(value ?? "").trim();
  return text || null;
};

/**
 * A driver, as the form holds it.
 *
 * A driver is an account first: `userId` is required because a driver has to
 * be able to sign in to the driver app, and a driver record with nobody behind
 * it is a row that can never be given a job.
 */
export function driverPayload(form, { isNew = true } = {}) {
  const errors = {};
  if (isNew && !form.userId) errors.userId = "Choose the account this driver signs in with.";
  if (!VEHICLES[form.vehicleType]) errors.vehicleType = "What do they ride?";

  const max = form.maxActiveOrders === "" || form.maxActiveOrders == null ? null : Number(form.maxActiveOrders);
  if (max != null && (!Number.isInteger(max) || max < 1 || max > 20)) {
    errors.maxActiveOrders = "Between 1 and 20 jobs at once.";
  }

  const rate = String(form.payoutPerDelivery ?? "").trim();
  if (rate && !/^\d+(\.\d{1,2})?$/.test(rate.replace(/,/g, ""))) {
    errors.payoutPerDelivery = "Enter an amount, e.g. 150";
  }

  if (form.licenseExpiry && !/^\d{4}-\d{2}-\d{2}$/.test(form.licenseExpiry)) {
    errors.licenseExpiry = "Give the expiry as a date.";
  }

  return {
    body: {
      ...(isNew ? { userId: form.userId } : {}),
      branchId: form.branchId || null,
      vehicleType: form.vehicleType,
      vehicleNumber: trimmed(form.vehicleNumber),
      licenseNumber: trimmed(form.licenseNumber),
      licenseExpiry: form.licenseExpiry || null,
      ...(max != null ? { maxActiveOrders: max } : {}),
      payoutPerDelivery: rate ? Number(rate.replace(/,/g, "")) : null,
      isActive: form.isActive !== false,
    },
    errors,
  };
}

/**
 * Whether a licence is a problem yet.
 *
 * Shown on the driver's own page rather than buried, because a rider on the
 * road with an expired licence is the restaurant's liability, not only theirs.
 */
export function licenceState(expiry, { now = new Date() } = {}) {
  if (!expiry) return null;

  // Whole calendar days, not elapsed hours. A licence valid until the 20th is
  // valid all of the 20th, and counting from "now" makes it expire half a day
  // early — the same reason a bill due today is due all day.
  const due = new Date(expiry);
  const days = Math.round(
    (Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate()) -
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) /
      86_400_000,
  );
  if (days < 0) return { label: `Licence expired ${-days} ${-days === 1 ? "day" : "days"} ago`, tone: "bg-error-container text-on-error-container" };
  if (days <= 30) return { label: `Licence expires in ${days} ${days === 1 ? "day" : "days"}`, tone: "bg-warning-container text-on-warning-container" };
  return null;
}

// --- payouts ----------------------------------------------------------------

export const PAYOUT_STATES = {
  DRAFT: { label: "Draft", tone: "bg-surface-container-high text-on-surface-variant" },
  APPROVED: { label: "Approved", tone: "bg-secondary-container text-on-secondary-container" },
  PAID: { label: "Paid", tone: "bg-success-container text-on-success-container" },
  CANCELLED: { label: "Cancelled", tone: "bg-surface-container-high text-on-surface-variant" },
};

export const PAYOUT_STAGE_HINT = {
  DRAFT: "Worked out but not agreed. Nothing has been promised and nothing has reached the books.",
  APPROVED: "Agreed. This is what the driver is owed; recording the payment is the last step.",
  PAID: "Money has gone out. A paid payout cannot be unwound here.",
  CANCELLED: "Written off. The deliveries in it are free to be included in a later run.",
};

export const payoutApprovable = (status) => status === "DRAFT";
export const payoutPayable = (status) => status === "APPROVED";

/**
 * What a driver is actually handed.
 *
 * Earnings less the cash they are still holding. A driver who collected COD
 * all evening has the restaurant's money in their bag, and paying them their
 * full earnings on top of it pays them twice — so the deduction is shown as
 * its own line rather than folded into a single figure nobody can check.
 */
export function payoutBreakdown(payout) {
  // Column names taken from the schema, not guessed: `earningsAmount`,
  // `tipsAmount`, `adjustmentAmount`, `codDeduction`. A guessed name reads
  // `undefined`, which here would quietly show a driver as owed nothing.
  const earned = addAmounts(payout?.earningsAmount ?? 0, payout?.tipsAmount ?? 0);
  const held = String(payout?.codDeduction ?? 0);
  const adjustment = String(payout?.adjustmentAmount ?? 0);

  // The same sum the server made, shown as its parts so the figure can be
  // read rather than taken on trust: earnings + tips + adjustment − cash held.
  //
  // Signed, not clamped: a driver who collected more COD than they earned owes
  // the restaurant money, and rounding that up to zero would hide the debt.
  const expected = minusAmounts(addAmounts(earned, adjustment), held);

  return {
    earned,
    held,
    adjustment,
    expected,
    /** True when the parts do not reconstruct the stored total. */
    disagrees: payout?.netAmount != null && compare(decimal(expected), decimal(payout.netAmount)) !== 0,
  };
}

export function generatePayoutPayload(form) {
  const errors = {};
  if (!form.periodStart) errors.periodStart = "From when?";
  if (!form.periodEnd) errors.periodEnd = "Until when?";
  else if (form.periodStart && form.periodEnd < form.periodStart) errors.periodEnd = "The period runs backwards.";

  const adjustment = String(form.adjustmentAmount ?? "").trim();
  if (adjustment && !/^-?\d+(\.\d{1,2})?$/.test(adjustment.replace(/,/g, ""))) {
    errors.adjustmentAmount = "Enter an amount — negative for a deduction.";
  }

  return {
    body: {
      ...(form.driverId ? { driverId: form.driverId } : {}),
      ...(form.branchId ? { branchId: form.branchId } : {}),
      periodStart: form.periodStart,
      periodEnd: form.periodEnd,
      ...(adjustment ? { adjustmentAmount: Number(adjustment.replace(/,/g, "")) } : {}),
    },
    errors,
  };
}

/** Whether a driver is holding cash that has not been handed back. */
export const holdingCash = (driver) => compare(decimal(driver?.cashInHand ?? 0), decimal(0)) > 0;

/** A `YYYY-MM-DD` key, kept as a string so a date column never drifts a day. */
export const dayKey = (value = new Date()) =>
  typeof value === "string" ? value.slice(0, 10) : new Date(value).toISOString().slice(0, 10);

/** The whole of last week, which is what a payout run almost always covers. */
export function lastWeek(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const start = new Date(end.getTime() - 6 * 86_400_000);
  return { periodStart: dayKey(start), periodEnd: dayKey(end) };
}
