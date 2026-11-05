/**
 * Turning a branch record into form state, and form state back into a request.
 *
 * Kept out of the component because the interesting part is not the markup: an
 * HTML input has exactly one empty value, `""`, and the API has two — `null`
 * ("this branch has no second address line") and absent ("use the default").
 * Sending `""` where the schema wants an optional email is a validation error
 * for a field the user deliberately left blank, which reads to them as the form
 * refusing itself. That mapping is a rule, so it is tested like one.
 */

/** Fields the form renders — also the set `toFormErrors` is allowed to pin messages to. */
export const BRANCH_FIELDS = [
  "code",
  "name",
  "legalName",
  "taxIdentifier",
  "phone",
  "email",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "country",
  "postalCode",
  "latitude",
  "longitude",
  "timezone",
  "currency",
  "deliveryRadiusKm",
  "openedAt",
];

export const BRANCH_DEFAULTS = {
  code: "",
  name: "",
  legalName: "",
  taxIdentifier: "",
  phone: "",
  email: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  country: "PK",
  postalCode: "",
  latitude: "",
  longitude: "",
  timezone: "Asia/Karachi",
  currency: "PKR",
  deliveryRadiusKm: "",
  openedAt: "",
  isActive: true,
};

/** `2026-09-16` from a Date or ISO string, which is what `<input type="date">` wants. */
export function toDateInput(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

/** Form state for an existing branch — every null becomes the empty input. */
export function branchFormValues(branch) {
  if (!branch) return { ...BRANCH_DEFAULTS };

  const text = (value) => (value === null || value === undefined ? "" : String(value));

  return {
    ...BRANCH_DEFAULTS,
    ...Object.fromEntries(BRANCH_FIELDS.map((field) => [field, text(branch[field])])),
    openedAt: toDateInput(branch.openedAt),
    isActive: Boolean(branch.isActive),
  };
}

/** Fields where a blank box means "the server should pick", not "store nothing". */
const DEFAULTED = new Set(["country", "timezone", "currency"]);
/** Fields the schema reads as numbers. */
const NUMERIC = new Set(["latitude", "longitude", "deliveryRadiusKm"]);
/** Fields that must always be present. */
const REQUIRED = new Set(["code", "name"]);

/**
 * The request body.
 *
 * A blank optional field is sent as `null` so clearing a phone number actually
 * clears it — omitting the key on a PATCH would silently keep the old value,
 * and the user would watch a field they emptied come back.
 */
export function branchPayload(form) {
  const body = { isActive: Boolean(form.isActive) };

  for (const field of BRANCH_FIELDS) {
    const raw = typeof form[field] === "string" ? form[field].trim() : form[field];

    if (raw === "" || raw === null || raw === undefined) {
      // A defaulted field left blank is omitted entirely: sending `null` would
      // be rejected, and sending `""` fails a fixed-length check.
      if (DEFAULTED.has(field) || REQUIRED.has(field)) continue;
      body[field] = null;
      continue;
    }

    body[field] = NUMERIC.has(field) ? Number(raw) : raw;
  }

  return body;
}
