/**
 * Turns an API failure into something a form can render.
 *
 * The API answers a rejected body with `error.details` mapping field path to
 * messages — `{ email: ["Enter a valid email address"] }`. Those messages are
 * written to be read by a person, so they go next to the field that caused
 * them rather than into a toast, where the reader has to work out which of six
 * inputs is wrong.
 *
 * Everything else — wrong password, rate limited, server down — has no field to
 * attach to and becomes the form-level message.
 */
export function toFormErrors(error, { fields = [], conflictField = null } = {}) {
  const details = error?.details;
  const fieldErrors = {};

  // A CONFLICT carries no `details` — it is a uniqueness clash the database
  // found, not a shape the validator rejected — but the caller usually knows
  // which field it can only be about. "That email is already registered"
  // belongs beside the email box, not in a banner above six of them.
  if (conflictField && error?.code === "CONFLICT" && error?.message) {
    return { fieldErrors: { [conflictField]: error.message }, formError: null };
  }

  if (details && typeof details === "object" && !Array.isArray(details)) {
    for (const [key, value] of Object.entries(details)) {
      // Only paths the form actually renders: a message pinned to a field that
      // is not on screen would be invisible, and the user would see a form
      // that rejects itself for no stated reason.
      if (!fields.includes(key)) continue;
      const message = Array.isArray(value) ? value[0] : value;
      if (typeof message === "string" && message) fieldErrors[key] = message;
    }
  }

  const unattached = Object.keys(fieldErrors).length === 0;

  return {
    fieldErrors,
    // When every problem is already shown beside a field, repeating the generic
    // "the request could not be validated" above the form adds noise.
    formError: unattached ? (error?.message ?? "Something went wrong") : null,
  };
}

/** The `aria-describedby` wiring a field needs, or undefined when it has none. */
export function describedBy(...ids) {
  const present = ids.filter(Boolean);
  return present.length ? present.join(" ") : undefined;
}
