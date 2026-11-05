/**
 * Which table a customer is sitting at, remembered from the QR code they
 * scanned.
 *
 * A cookie rather than cart state because the cart is read in the browser
 * (a guest's basket is keyed by local storage) while checkout is what finally
 * needs the table — and because the thing being remembered is a fact about
 * where the person physically is, not about what is in their basket.
 *
 * **Deliberately short-lived.** A branch choice is worth remembering for a
 * year; a seat is not. Four hours covers the longest meal and expires well
 * before the same phone orders a delivery from home — a stale table id would
 * otherwise send tonight's delivery to the kitchen labelled "table 4".
 */
export const TABLE_COOKIE = "fz_table";

export const TABLE_COOKIE_MAX_AGE = 60 * 60 * 4;
