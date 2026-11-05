/**
 * Order statuses in the words staff use.
 *
 * The enum is the kitchen's vocabulary — READY, OUT_FOR_DELIVERY — and the
 * screens are read by people who think in "with the rider". Shared so that
 * every screen showing an order says the same thing about it.
 */
export const ORDER_STATES = {
  DRAFT: { label: "Draft", tone: "bg-surface-container-high text-on-surface-variant" },
  PENDING: { label: "New", tone: "bg-warning-container text-on-warning-container" },
  CONFIRMED: { label: "Confirmed", tone: "bg-secondary-container text-on-secondary-container" },
  PREPARING: { label: "Cooking", tone: "bg-secondary-container text-on-secondary-container" },
  READY: { label: "Ready", tone: "bg-secondary-container text-on-secondary-container" },
  OUT_FOR_DELIVERY: { label: "With the rider", tone: "bg-secondary-container text-on-secondary-container" },
  DELIVERED: { label: "Delivered", tone: "bg-success-container text-on-success-container" },
  COMPLETED: { label: "Completed", tone: "bg-success-container text-on-success-container" },
  CANCELLED: { label: "Cancelled", tone: "bg-surface-container-high text-on-surface-variant" },
  REJECTED: { label: "Rejected", tone: "bg-surface-container-high text-on-surface-variant" },
  REFUNDED: { label: "Refunded", tone: "bg-error-container text-on-error-container" },
};

export const ORDER_TYPE_LABELS = { DELIVERY: "Delivery", PICKUP: "Pickup", DINE_IN: "Dine-in" };

export const PAYMENT_STATES = {
  UNPAID: "Unpaid",
  AUTHORIZED: "Authorised",
  PAID: "Paid",
  PARTIALLY_PAID: "Part paid",
  PARTIALLY_REFUNDED: "Part refunded",
  REFUNDED: "Refunded",
  FAILED: "Payment failed",
};

export const orderStatusLabel = (status) => ORDER_STATES[status]?.label ?? status;
/**
 * The statuses in which the customer has actually got their food.
 *
 * Both, never just COMPLETED. `DELIVERED` is the end of a delivery order's
 * real life — the food is eaten — while `COMPLETED` is a back-office close-out
 * somebody may do days later or not at all; `PICKUP` and `DINE_IN` have no
 * `DELIVERED` leg and land on `COMPLETED` directly. Anything that asks "has
 * this person had this meal" — reviews, creator eligibility, attributed
 * earnings — must accept both, or delivery customers wait on an admin and
 * dine-in customers are let through immediately for the same meal.
 */
export const FULFILLED_STATUSES = ["DELIVERED", "COMPLETED"];
