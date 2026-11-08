/**
 * The rules a checkout has to satisfy, as pure functions.
 *
 * These mirror guards the server enforces in `checkout.service.js` — they do
 * not replace them. The server is the authority on every one of these, and it
 * re-checks all of them at the moment of purchase. What this file buys is the
 * difference between telling someone "a delivery order needs an account" while
 * the form is still empty and telling them after they have filled it in and
 * pressed Place order.
 *
 * Kept free of React and of the API client so the rules can be tested directly.
 */

/**
 * What a given order type asks of the customer.
 *
 * `needsAccount` is not a policy choice made here: the server refuses a guest
 * DELIVERY outright, because a delivery order is priced and routed against a
 * saved address and an address book belongs to an account. Pickup and dine-in
 * have no such requirement, so a guest may place them with a name and a phone.
 */
export function checkoutRequirements({ type, signedIn }) {
  const delivery = type === "DELIVERY";

  return {
    needsAddress: delivery,
    needsAccount: delivery,
    needsContact: !signedIn && !delivery,
    /**
     * Dine-in asks how many are eating, which the kitchen and the floor both
     * use. It is optional rather than required — the server defaults it — so it
     * never blocks an order.
     */
    wantsGuestCount: type === "DINE_IN",
    /**
     * A tip is offered where there is someone to tip: a rider, or the floor
     * staff serving a table. Prompting for one at a pickup counter the customer
     * is walking up to themselves is a nudge, not a service.
     */
    acceptsTip: delivery || type === "DINE_IN",
  };
}

/**
 * Everything standing between this basket and a placed order.
 *
 * Returns every blocker rather than just the first, so the page can show the
 * whole list at once instead of revealing one problem per attempt. Each carries
 * a `fix` saying where it is resolved — on this page, back in the basket, or in
 * the customer's account — which is what lets the UI offer the right link
 * instead of a generic "something is wrong".
 */
export function checkoutBlockers({
  cart,
  user = null,
  signedIn = false,
  addressId = null,
  guest = null,
}) {
  const blockers = [];
  const lines = cart?.items ?? [];
  const totals = cart?.totals ?? {};

  if (!lines.length) {
    blockers.push({ code: "EMPTY", fix: "cart", message: "Your order is empty." });
    // Nothing below can be judged without items, and a stack of consequent
    // complaints about an empty basket helps nobody.
    return blockers;
  }

  if (!cart?.branchId) {
    blockers.push({ code: "NO_BRANCH", fix: "cart", message: "Choose a location before checking out." });
  }

  const unavailable = lines.filter((line) => line.problem);
  if (unavailable.length) {
    blockers.push({
      code: "UNAVAILABLE_ITEMS",
      fix: "cart",
      message:
        unavailable.length === 1
          ? "One item in your order is no longer available."
          : `${unavailable.length} items in your order are no longer available.`,
    });
  }

  const minimum = Number(cart?.minimumOrderAmount ?? 0);
  if (minimum > 0 && Number(totals.subtotal ?? 0) < minimum) {
    blockers.push({ code: "BELOW_MINIMUM", fix: "cart", message: "Your order is below this branch's minimum." });
  }

  // An unverified account is refused by the server with a 403, so it is worth
  // saying before the form is filled in rather than after.
  if (signedIn && user && !user.emailVerified) {
    blockers.push({ code: "EMAIL_UNVERIFIED", fix: "account", message: "Verify your email address to order." });
  }

  const { needsAccount, needsAddress, needsContact } = checkoutRequirements({ type: cart?.type, signedIn });

  if (needsAccount && !signedIn) {
    blockers.push({ code: "SIGN_IN_REQUIRED", fix: "account", message: "Delivery orders need an account." });
  } else if (needsAddress && !addressId) {
    // Only worth asking for once they can actually have one.
    blockers.push({ code: "ADDRESS_REQUIRED", fix: "here", message: "Choose a delivery address." });
  }

  if (needsContact && !(guest?.name?.trim() && guest?.phone?.trim())) {
    blockers.push({ code: "CONTACT_REQUIRED", fix: "here", message: "Add a name and phone number." });
  }

  return blockers;
}

/**
 * The basket, in the shape `/checkout/quote` accepts.
 *
 * Only ids and quantities travel: what any of it costs is the server's to
 * decide, and a client that sent prices would be sending a suggestion the
 * server is right to ignore. Unavailable lines are dropped because the quote
 * would fail on them, and they are already reported as a blocker of their own.
 */
export function quoteItems(cart) {
  return (cart?.items ?? [])
    .filter((item) => !item.problem)
    .map((item) => ({
      productId: item.productId,
      ...(item.variantId ? { variantId: item.variantId } : {}),
      quantity: item.quantity,
      modifiers: (item.modifiers ?? []).map((modifier) => ({
        optionId: modifier.optionId,
        quantity: modifier.quantity ?? 1,
      })),
      comboSelections: (item.comboSelections ?? []).map((choice) => ({
        groupId: choice.groupId,
        productId: choice.productId,
        ...(choice.variantId ? { variantId: choice.variantId } : {}),
        quantity: choice.quantity ?? 1,
      })),
    }));
}

/** The tip buttons, as percentages of the subtotal. */
export const TIP_PERCENTS = [0, 5, 10, 15];

/**
 * Tip amounts for a subtotal.
 *
 * Rounded to two decimal places rather than to a whole unit: whole numbers read
 * better in PKR, but the same rounding turns a 10% tip on $12.30 into $1, and a
 * tip control that quietly changes the percentage it offered is worse than one
 * that shows an exact figure.
 */
export function tipPresets(subtotal) {
  const base = Number(subtotal);
  const safe = Number.isFinite(base) && base > 0 ? base : 0;

  return TIP_PERCENTS.map((percent) => ({
    percent,
    amount: Math.round(safe * percent) / 100,
  }));
}

/**
 * A typed tip, as a number the server will accept.
 *
 * Returns null for text that is not a usable amount at all — letters, a
 * negative, an infinity — so the caller can keep what the user typed on screen
 * while refusing to send it. Clearing the box under someone mid-type is the
 * usual alternative and it is infuriating.
 *
 * Excess precision is rounded rather than rejected. `moneySchema` allows four
 * decimal places, and nobody means anything by the fifth; refusing "1.23456"
 * outright would be pedantry, whereas sending it would earn a validation error
 * from the server for something the customer cannot see is wrong.
 */
export function parseTip(input) {
  if (input === "" || input === null || input === undefined) return 0;
  // `Number("")` is 0 and `Number(" ")` is 0, both already handled above; but
  // `Number([])` is also 0, so anything that is not a string or number is out.
  if (typeof input !== "string" && typeof input !== "number") return null;

  const value = Number(input);
  if (!Number.isFinite(value) || value < 0) return null;

  return Math.round(value * 10_000) / 10_000;
}

/**
 * The body for `POST /checkout`.
 *
 * The coupon is deliberately absent: it lives on the cart, so the server picks
 * it up itself and a customer who applied a code on the website still gets it
 * checking out from the app. Sending it back would only create a chance to send
 * a stale one.
 */
export function checkoutPayload({ cart, signedIn, addressId, guest, guestCount, note, tipAmount, tableId = null, payWith = null, storeCredit = 0 }) {
  const { needsAddress, needsContact, wantsGuestCount, acceptsTip } = checkoutRequirements({
    type: cart?.type,
    signedIn,
  });

  const trimmedNote = note?.trim();

  return {
    ...(cart?.branchId ? { branchId: cart.branchId } : {}),
    ...(cart?.type ? { type: cart.type } : {}),
    ...(needsAddress && addressId ? { addressId } : {}),
    ...(wantsGuestCount && guestCount ? { guestCount } : {}),
    // Only on a dine-in order, and only from a scanned table code. Sending a
    // stale table on a delivery would label it for a seat nobody is in.
    ...(wantsGuestCount && tableId ? { tableId } : {}),
    ...(trimmedNote ? { customerNote: trimmedNote } : {}),
    tipAmount: acceptsTip ? (tipAmount ?? 0) : 0,
    // Absent means settle in person, which stays the default. Only sent when
    // the customer actually picked a gateway.
    ...(payWith ? { payWith } : {}),
    /*
     * Store credit, only when there is some to spend and the customer applied
     * it. Omitted rather than sent as zero: the server reads any positive
     * amount as "spend this", and a stray zero on a guest checkout would be
     * refused for having no account rather than ignored.
     */
    ...(storeCredit > 0 ? { storeCredit } : {}),
    ...(needsContact
      ? {
          guest: {
            name: guest.name.trim(),
            phone: guest.phone.trim(),
            ...(guest.email?.trim() ? { email: guest.email.trim() } : {}),
          },
        }
      : {}),
  };
}
