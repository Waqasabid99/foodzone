/**
 * The discount screens' vocabulary and rules, with no React and no database
 * in it.
 *
 * A promotion is the one record in this system that is **easier to get wrong
 * than to notice**. A tax rate that is wrong is wrong on every receipt; an
 * offer that is wrong simply never fires, or fires on everything, and either
 * way nothing errors. So most of what is here exists to say out loud what an
 * offer will actually do before it is saved: what it discounts, when it
 * applies, and the combinations that mean "never".
 *
 * `coherenceProblems` deliberately mirrors the server's
 * `assertPromotionIsCoherent`. A unit test holds the two together, because a
 * form that accepts what the API refuses is a worse experience than no
 * validation at all.
 */

const CHIP = {
  good: "bg-success-container text-on-success-container",
  warn: "bg-warning-container text-on-warning-container",
  bad: "bg-error-container text-on-error-container",
  live: "bg-secondary-container text-on-secondary-container",
  quiet: "bg-surface-container-high text-on-surface-variant",
};

// --- what a discount is -----------------------------------------------------

/**
 * The kinds of offer, and which inputs each one actually uses.
 *
 * `fields` drives the form: showing a "buy quantity" box on a percentage
 * discount invites somebody to fill it in, and then wonder why it did
 * nothing.
 */
export const DISCOUNT_TYPES = {
  PERCENTAGE: {
    label: "Percentage off",
    note: "A share of the qualifying lines. Cap it unless you are happy for it to apply to a very large order.",
    fields: ["value", "maxDiscountAmount"],
    unit: "%",
  },
  FIXED_AMOUNT: {
    label: "Amount off",
    note: "A flat sum off the order.",
    fields: ["value"],
    unit: "money",
  },
  FREE_DELIVERY: {
    label: "Free delivery",
    note: "Takes the delivery fee off. Does nothing on a collection or dine-in order.",
    fields: [],
    unit: null,
  },
  FREE_ITEM: {
    label: "Free item",
    note: "Gives away items from the targets below.",
    fields: ["getQuantity"],
    unit: null,
  },
  BUY_X_GET_Y: {
    label: "Buy X get Y",
    note: "Buy a number of one thing, get a number of another free.",
    fields: ["buyQuantity", "getQuantity", "maxDiscountAmount"],
    unit: null,
  },
  BUNDLE_PRICE: {
    label: "Bundle price",
    note: "Sets a fixed price for the targets together.",
    fields: ["value"],
    unit: "money",
  },
};

export const DISCOUNT_TYPE_ORDER = ["PERCENTAGE", "FIXED_AMOUNT", "FREE_DELIVERY", "FREE_ITEM", "BUY_X_GET_Y", "BUNDLE_PRICE"];

export const typeLabel = (type) => DISCOUNT_TYPES[type]?.label ?? type ?? "Offer";

/** Whether a given input is meaningful for this kind of offer. */
export const usesField = (type, field) => Boolean(DISCOUNT_TYPES[type]?.fields.includes(field));

/**
 * What the offer does, in one line.
 *
 * Written as a sentence rather than a row of fields because "20% / 100 / 500"
 * is three numbers whose relationship has to be reconstructed every time it
 * is read.
 */
export function discountSummary(promotion, { currency = null, formatMoney = (value) => String(value) } = {}) {
  if (!promotion) return "";
  const value = Number(promotion.value ?? 0);
  const money = (amount) => formatMoney(amount, currency);

  switch (promotion.type) {
    case "PERCENTAGE":
      return promotion.maxDiscountAmount != null
        ? `${value}% off, up to ${money(promotion.maxDiscountAmount)}`
        : `${value}% off`;
    case "FIXED_AMOUNT":
      return `${money(value)} off`;
    case "FREE_DELIVERY":
      return "Free delivery";
    case "FREE_ITEM":
      return `${promotion.getQuantity ?? 1} free`;
    case "BUY_X_GET_Y":
      return `Buy ${promotion.buyQuantity ?? 1}, get ${promotion.getQuantity ?? 1} free`;
    case "BUNDLE_PRICE":
      return `Bundle price ${money(value)}`;
    default:
      return typeLabel(promotion.type);
  }
}

/** The conditions that have to be met, as a list of short phrases. */
export function conditionList(promotion, { currency = null, formatMoney = (value) => String(value) } = {}) {
  const out = [];
  if (promotion.minOrderAmount != null) out.push(`order of at least ${formatMoney(promotion.minOrderAmount, currency)}`);
  if (promotion.minItemCount != null) out.push(`at least ${promotion.minItemCount} items`);
  if (promotion.newCustomersOnly) out.push("first order only");
  if (promotion.requiresCoupon) out.push("needs a code");
  if (promotion.usageLimitPerUser != null) out.push(`${promotion.usageLimitPerUser} per customer`);
  return out;
}

// --- when it applies --------------------------------------------------------

export const DAYS = [
  { value: 0, label: "Sun", long: "Sunday" },
  { value: 1, label: "Mon", long: "Monday" },
  { value: 2, label: "Tue", long: "Tuesday" },
  { value: 3, label: "Wed", long: "Wednesday" },
  { value: 4, label: "Thu", long: "Thursday" },
  { value: 5, label: "Fri", long: "Friday" },
  { value: 6, label: "Sat", long: "Saturday" },
];

/**
 * Minutes from midnight as a clock time.
 *
 * Past 1440 means the window runs into tomorrow, which is how a late-night
 * offer is expressed. `25:30` would be unreadable, so it is shown as the real
 * time with the day it lands on spelled out.
 */
export function minuteLabel(minute) {
  if (minute == null) return "";
  const wrapped = minute % 1440;
  const hours = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const minutes = String(wrapped % 60).padStart(2, "0");
  return `${hours}:${minutes}${minute >= 1440 ? " next day" : ""}`;
}

/** `"14:30"` into minutes from midnight. Null when not a time. */
export function minuteFromInput(text, { nextDay = false } = {}) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes + (nextDay ? 1440 : 0);
}

/** Minutes back into an `<input type="time">` value. */
export const minuteToInput = (minute) =>
  minute == null ? "" : `${String(Math.floor((minute % 1440) / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/** When the offer runs, in a sentence. */
export function scheduleSummary(promotion, { dateLabel = (value) => String(value) } = {}) {
  const parts = [];

  const days = promotion.daysOfWeek ?? [];
  if (days.length && days.length < 7) {
    parts.push(days.map((day) => DAYS[day]?.label ?? day).join(", "));
  }

  if (promotion.startMinute != null && promotion.endMinute != null) {
    parts.push(`${minuteLabel(promotion.startMinute)}–${minuteLabel(promotion.endMinute)}`);
  }

  if (promotion.startsAt && promotion.endsAt) parts.push(`${dateLabel(promotion.startsAt)} to ${dateLabel(promotion.endsAt)}`);
  else if (promotion.startsAt) parts.push(`from ${dateLabel(promotion.startsAt)}`);
  else if (promotion.endsAt) parts.push(`until ${dateLabel(promotion.endsAt)}`);

  return parts.length ? parts.join(" · ") : "Any time";
}

// --- where it applies -------------------------------------------------------

/**
 * Which outlets an offer covers.
 *
 * The third case is the one worth having: a promotion pinned to a branch that
 * has since been deleted can never fire, and it looks completely normal in a
 * list. Saying so is the difference between a dead row and a mystery.
 */
export function reachSummary(promotion, branchNames = {}) {
  const ids = promotion?.branchIds ?? [];
  if (!ids.length) return { label: "Every branch", tone: CHIP.live, dead: false };

  const known = ids.filter((id) => branchNames[id]);
  const missing = ids.length - known.length;

  if (!known.length) {
    return {
      label: missing === 1 ? "A branch that no longer exists" : `${missing} branches that no longer exist`,
      tone: CHIP.bad,
      dead: true,
      note: "This offer can never apply — the outlets it was pinned to are gone.",
    };
  }

  const label = known.map((id) => branchNames[id]).join(", ");
  return {
    label: missing ? `${label} (+${missing} since deleted)` : label,
    tone: CHIP.quiet,
    dead: false,
    ...(missing ? { note: "Some of the branches this was pinned to no longer exist." } : {}),
  };
}

// --- is it actually running? ------------------------------------------------

/**
 * Whether an offer is live right now, and if not, why not.
 *
 * Six states rather than a boolean, because "not running" has six different
 * causes and five of them are fixable. An `isActive` toggle alone cannot tell
 * somebody their campaign ended on Tuesday.
 */
export function promotionState(promotion, now = new Date()) {
  if (!promotion) return { key: "unknown", label: "Unknown", tone: CHIP.quiet, note: "" };

  if (!promotion.isActive) {
    return { key: "paused", label: "Paused", tone: CHIP.quiet, note: "Switched off. Nothing will apply it." };
  }
  if (promotion.usageLimit != null && (promotion.usageCount ?? 0) >= promotion.usageLimit) {
    return { key: "used-up", label: "Used up", tone: CHIP.warn, note: "It has hit its total redemption limit." };
  }
  if (promotion.startsAt && new Date(promotion.startsAt) > now) {
    return { key: "scheduled", label: "Scheduled", tone: CHIP.live, note: "Waiting for its start date." };
  }
  if (promotion.endsAt && new Date(promotion.endsAt) < now) {
    return { key: "expired", label: "Ended", tone: CHIP.quiet, note: "Its end date has passed." };
  }
  return { key: "live", label: "Live", tone: CHIP.good, note: "Running now, where its other conditions are met." };
}

export function couponState(coupon, now = new Date()) {
  if (!coupon) return { key: "unknown", label: "Unknown", tone: CHIP.quiet };
  if (!coupon.isActive) return { key: "revoked", label: "Revoked", tone: CHIP.bad, note: "Switched off. It will be refused." };
  if (coupon.maxRedemptions != null && (coupon.redemptionCount ?? 0) >= coupon.maxRedemptions) {
    return { key: "used-up", label: "Used up", tone: CHIP.warn, note: "It has been redeemed as often as it is allowed." };
  }
  if (coupon.startsAt && new Date(coupon.startsAt) > now) {
    return { key: "scheduled", label: "Not yet valid", tone: CHIP.live, note: "Waiting for its start date." };
  }
  if (coupon.expiresAt && new Date(coupon.expiresAt) < now) {
    return { key: "expired", label: "Expired", tone: CHIP.quiet, note: "Past its expiry date." };
  }
  return { key: "live", label: "Usable", tone: CHIP.good, note: "A customer can redeem this now." };
}

export const PROMOTION_FILTERS = [
  { value: "", label: "All" },
  { value: "live", label: "Live" },
  { value: "scheduled", label: "Scheduled" },
  { value: "paused", label: "Paused" },
  { value: "expired", label: "Ended" },
];

/** How much of a usage allowance is gone, for a progress read-out. */
export function usageSummary({ used = 0, limit = null } = {}) {
  const count = Number(used ?? 0);
  if (limit == null) return { label: `${count} used`, percent: null, exhausted: false };
  const percent = limit > 0 ? Math.min(100, Math.round((count / limit) * 100)) : 100;
  return { label: `${count} of ${limit} used`, percent, exhausted: count >= limit };
}

// --- the rules, mirrored from the server ------------------------------------

/**
 * The same checks `assertPromotionIsCoherent` makes, run as you type.
 *
 * Kept deliberately in step with the server rather than being a looser
 * client-side approximation: a form that accepts what the API refuses
 * teaches people to distrust the form, and one that refuses what the API
 * accepts silently removes a feature.
 */
export function coherenceProblems(form) {
  const problems = {};
  const type = form.type;
  const value = form.value === "" || form.value == null ? null : Number(form.value);

  if (type === "PERCENTAGE" && (value == null || value <= 0 || value > 100)) {
    problems.value = "A percentage discount must be between 0 and 100";
  }
  if ((type === "FIXED_AMOUNT" || type === "BUNDLE_PRICE") && (value == null || value <= 0)) {
    problems.value = "Set the amount this offer is worth";
  }
  if (type === "BUY_X_GET_Y") {
    if (!form.buyQuantity || Number(form.buyQuantity) < 1) problems.buyQuantity = "Set how many must be bought";
    if (!form.getQuantity || Number(form.getQuantity) < 1) problems.getQuantity = "Set how many are free";
  }
  if (type === "FREE_ITEM" && (!form.getQuantity || Number(form.getQuantity) < 1)) {
    problems.getQuantity = "Set how many items are free";
  }

  const capped = form.maxDiscountAmount !== "" && form.maxDiscountAmount != null;
  if (capped && type !== "PERCENTAGE" && type !== "BUY_X_GET_Y") {
    problems.maxDiscountAmount = "A maximum only applies to percentage and buy-x-get-y offers";
  }

  const hasStart = form.startMinute != null;
  const hasEnd = form.endMinute != null;
  if (hasStart !== hasEnd) problems.startMinute = "Set both a start and an end time, or neither";
  if (hasStart && hasEnd && form.endMinute <= form.startMinute) {
    problems.endMinute = "The end time must be after the start time; tick 'runs past midnight' to cross a day";
  }

  if (form.startsAt && form.endsAt && new Date(form.endsAt) <= new Date(form.startsAt)) {
    problems.endsAt = "The end date must be after the start date";
  }

  return problems;
}

/**
 * Warnings that are not errors: an offer that would save, and do nothing.
 *
 * The server is right not to refuse these — they are legal, and sometimes
 * deliberate — but each one is far more often a mistake than an intention,
 * and none of them produces any visible symptom afterwards.
 */
export function wouldNeverFire(form) {
  const notes = [];

  if (form.type === "FREE_DELIVERY" && form.orderTypes?.length && !form.orderTypes.includes("DELIVERY")) {
    notes.push("Free delivery on an offer limited to collection or dine-in will never take anything off.");
  }
  if ((form.type === "FREE_ITEM" || form.type === "BUY_X_GET_Y" || form.type === "BUNDLE_PRICE") && !form.targets?.length) {
    notes.push("This kind of offer gives away specific items, so it needs at least one target below.");
  }
  if (form.daysOfWeek?.length === 0 && form.everyDay === false) {
    notes.push("No days are ticked, so this will never run.");
  }
  if (form.requiresCoupon && form.isActive !== false) {
    notes.push("This needs a code, so nothing happens until you create one for it.");
  }
  if (form.endsAt && new Date(form.endsAt) < new Date()) {
    notes.push("The end date is in the past, so this will not run.");
  }
  if (form.targets?.length && form.targets.every((target) => target.isExcluded)) {
    notes.push("Every target is an exclusion, which excludes everything and leaves nothing to discount.");
  }

  return notes;
}

// --- payloads ---------------------------------------------------------------

const orNull = (value) => (value === "" || value == null ? null : Number(value));

export function promotionPayload(form) {
  const type = form.type;
  const uses = (field) => usesField(type, field);

  return {
    name: form.name?.trim(),
    description: form.description?.trim() || undefined,
    type,
    // Only the fields this kind of offer uses are sent. A leftover buy
    // quantity on a percentage discount is noise the server would store and
    // the next reader would try to interpret.
    value: uses("value") ? Number(form.value || 0) : 0,
    maxDiscountAmount: uses("maxDiscountAmount") ? orNull(form.maxDiscountAmount) : null,
    minOrderAmount: orNull(form.minOrderAmount),
    minItemCount: orNull(form.minItemCount),
    buyQuantity: uses("buyQuantity") ? orNull(form.buyQuantity) : null,
    getQuantity: uses("getQuantity") ? orNull(form.getQuantity) : null,
    branchIds: form.branchIds ?? [],
    channels: form.channels ?? [],
    orderTypes: form.orderTypes ?? [],
    daysOfWeek: form.everyDay ? [] : (form.daysOfWeek ?? []),
    startMinute: form.startMinute ?? null,
    endMinute: form.endMinute ?? null,
    startsAt: form.startsAt || null,
    endsAt: form.endsAt || null,
    newCustomersOnly: Boolean(form.newCustomersOnly),
    isStackable: Boolean(form.isStackable),
    priority: Number(form.priority ?? 0),
    usageLimit: orNull(form.usageLimit),
    usageLimitPerUser: orNull(form.usageLimitPerUser),
    requiresCoupon: Boolean(form.requiresCoupon),
    isActive: form.isActive !== false,
    targets: (form.targets ?? [])
      .filter((target) => target.targetType === "ORDER" || target.targetId)
      .map((target) => ({
        targetType: target.targetType,
        targetId: target.targetType === "ORDER" ? null : target.targetId,
        isExcluded: Boolean(target.isExcluded),
        ...(target.role ? { role: target.role } : {}),
      })),
  };
}

export function couponPayload(form) {
  return {
    code: normaliseCode(form.code),
    promotionId: form.promotionId,
    description: form.description?.trim() || undefined,
    assignedToId: form.assignedToId || null,
    maxRedemptions: orNull(form.maxRedemptions),
    maxRedemptionsPerUser: orNull(form.maxRedemptionsPerUser),
    startsAt: form.startsAt || null,
    expiresAt: form.expiresAt || null,
    campaign: form.campaign?.trim() || null,
    isActive: form.isActive !== false,
  };
}

/**
 * Codes are typed off flyers and read down phone lines.
 *
 * Upper-cased and stripped of spaces to match what the server stores, so the
 * code shown on screen is the code a customer can actually type.
 */
export const normaliseCode = (code) => String(code ?? "").trim().toUpperCase().replace(/\s+/g, "");

/** Characters that look alike on a printed flyer. */
const AMBIGUOUS = /[O0I1L]/;

/**
 * Whether a code will survive being read aloud or off paper.
 *
 * Not an error — plenty of good codes contain an O — but worth saying before
 * ten thousand are printed, because every one of these turns into a support
 * call that begins "it says the code is invalid".
 */
export const isHardToRead = (code) => AMBIGUOUS.test(String(code ?? ""));

export const codeExample = (prefix, length) =>
  `${normaliseCode(prefix)}${"X".repeat(Math.max(0, Math.min(Number(length) || 8, 24)))}`;
