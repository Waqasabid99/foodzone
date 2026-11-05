/**
 * Customer and review screens — labels, edit rules and the plain-English
 * descriptions of what a status means. Pure, so the wording is unit-tested.
 */

export const CUSTOMER_KINDS = [
  { value: "", label: "Everyone" },
  { value: "ACCOUNT", label: "Registered accounts" },
  { value: "GUEST", label: "Guests (no account)" },
];

export const CUSTOMER_FIELDS = ["name", "phone", "locale"];

/**
 * What an account's status means for the person, not the database.
 *
 * "Suspended" is not a state anyone can act on; "cannot sign in or order" is.
 */
export const ACCOUNT_STATES = {
  ACTIVE: { label: "Active", tone: "bg-success-container text-on-success-container", detail: "Can sign in and order." },
  PENDING_VERIFICATION: {
    label: "Unverified",
    tone: "bg-warning-container text-on-warning-container",
    detail: "Signed up but has not confirmed their email. They can browse and build an order.",
  },
  SUSPENDED: {
    label: "Suspended",
    tone: "bg-error-container text-on-error-container",
    detail: "Blocked from signing in or ordering until restored.",
  },
  DEACTIVATED: {
    label: "Closed",
    tone: "bg-surface-container-high text-on-surface-variant",
    detail: "The account was closed. Their past orders are kept.",
  },
};

export const REVIEW_STATES = {
  PENDING: { label: "Waiting", tone: "bg-warning-container text-on-warning-container", detail: "Not shown to anyone yet." },
  PUBLISHED: { label: "Published", tone: "bg-success-container text-on-success-container", detail: "Shown on the product page." },
  REJECTED: { label: "Rejected", tone: "bg-surface-container-high text-on-surface-variant", detail: "Hidden. The customer still sees their own." },
};

/** "Never" reads better than an empty cell, and says the same thing. */
export function lastSeen(date, { now = new Date() } = {}) {
  if (!date) return "Never";
  const then = new Date(date);
  const days = Math.floor((now - then) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} ${months === 1 ? "month" : "months"} ago`;
  }
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

export function customerFormValues(customer = null) {
  return {
    name: customer?.name ?? "",
    phone: customer?.phone ?? "",
    locale: customer?.locale ?? "en",
  };
}

/**
 * The edit form → an API body, or field errors.
 *
 * Only the fields that changed are sent: a PATCH that re-sends the phone number
 * would clear its verified mark every time someone corrects a spelling in the
 * name.
 */
export function customerPayload(form, { original = null } = {}) {
  const errors = {};
  const body = {};

  const name = form.name.trim();
  if (name.length < 2) errors.name = "Enter their name.";
  else if (name.length > 80) errors.name = "Keep it under 80 characters.";
  else if (!original || name !== original.name) body.name = name;

  const phone = form.phone.trim();
  if (phone && !/^[+]?[\d\s()-]{7,20}$/.test(phone)) errors.phone = "Enter a valid phone number, e.g. +92 300 1234567.";
  else if (!original || phone !== (original.phone ?? "")) body.phone = phone || null;

  if (!Object.keys(errors).length && !Object.keys(body).length) errors.form = "Nothing has changed.";

  return { body, errors };
}

/** What changing the phone number costs, said before it is saved. */
export function phoneChangeWarning(form, original) {
  if (!original?.phone || form.phone.trim() === original.phone) return null;
  return original.phoneVerifiedAt
    ? "This number is confirmed. Changing it marks it unconfirmed until they confirm the new one."
    : null;
}
