import { parseMoney } from "@/lib/product-form";

/**
 * Menu forms, schedules and health — pure, shared by the dashboard pages and
 * the unit tests.
 *
 * Every time a menu stores is in its branch's own timezone: `startMinute` and
 * `endMinute` are minutes past local midnight, and a date range starts and ends
 * at local midnight. Someone in Karachi scheduling "lunch, 12:00–15:00" for a
 * branch in Dubai means Dubai's noon, so nothing here reads the viewer's own
 * clock for anything but "now".
 */

export const MENU_TYPES = [
  { value: "DINE_IN", label: "Dine-in", hint: "Also used for delivery and pickup orders when there is no menu for those." },
  { value: "DELIVERY", label: "Delivery", hint: "Delivery orders from the website and app." },
  { value: "TAKEAWAY", label: "Pickup", hint: "Orders collected from the counter." },
  { value: "QR", label: "QR table ordering", hint: "Scanned at a table." },
  { value: "POS", label: "Counter (POS)", hint: "Staff taking orders at the till." },
  { value: "CATERING", label: "Catering", hint: "Large pre-orders." },
];

export const menuTypeLabel = (type) => MENU_TYPES.find((entry) => entry.value === type)?.label ?? type;

/** Monday first, the way a restaurant's week reads. `value` is JS's 0 = Sunday. */
export const WEEKDAYS = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 0, short: "Sun", long: "Sunday" },
];

export const MENU_FIELDS = ["branchId", "name", "type", "description", "isDefault", "startMinute", "endMinute", "daysOfWeek", "activeFrom", "activeTo"];

// --- clock & timezone arithmetic -------------------------------------------

/** "9:05", "09:05" or "21:30" → minutes past midnight. Anything else → null. */
export function parseClock(input) {
  const match = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(input ?? ""));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** Minutes past midnight → "HH:MM". Past 1440 wraps, because that is the next day's clock. */
export function formatClock(minutes) {
  const value = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

/** The wall clock in `timezone` at `at`. */
export function zonedParts(timezone, at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour,
    minute,
    second: Number(get("second")),
    dayOfWeek: weekdays[get("weekday")] ?? 0,
    minutes: hour * 60 + minute,
  };
}

/** How far `timezone`'s wall clock is ahead of UTC at `at`, in milliseconds. */
function offsetAt(timezone, at) {
  const p = zonedParts(timezone, at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * "2026-10-01" plus a wall-clock time → the instant it really is.
 *
 * `minutes` is minutes past local midnight and may exceed 1440, which is how
 * this codebase writes past-midnight service: "closes at 02:00" is 1560.
 *
 * The two passes matter. Adding minutes to midnight is only correct while the
 * offset holds for the whole day, and on a daylight-saving Sunday it does not:
 * 19:00 would land an hour out. Re-deriving the offset *at the answer* fixes
 * it. Pakistan has no daylight saving, so this is invisible here and would be
 * a twice-yearly hour of wrong pickup times for a branch anywhere that does.
 */
export function zonedInstant(dateInput, minutes = 0, timezone = "UTC") {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateInput ?? ""));
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const guess = Date.UTC(year, month - 1, day);
  const check = new Date(guess);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;

  const wanted = guess + Number(minutes || 0) * 60_000;
  let instant = wanted - offsetAt(timezone, new Date(wanted));
  instant = wanted - offsetAt(timezone, new Date(instant));
  return new Date(instant);
}

/** "2026-10-01" → the instant it becomes that date in `timezone`. Null if not a date. */
export function localMidnight(dateInput, timezone) {
  return zonedInstant(dateInput, 0, timezone);
}

/** The date `instant` falls on in `timezone`, as a date input value. */
export function zonedDateInput(instant, timezone) {
  if (!instant) return "";
  const p = zonedParts(timezone, new Date(instant));
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function addDays(dateInput, days) {
  const [year, month, day] = dateInput.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

/** The next local midnight in `timezone` — "sold out for the rest of today". */
export function endOfLocalDay(timezone, at = new Date()) {
  return localMidnight(addDays(zonedDateInput(at, timezone), 1), timezone);
}

export function formatZoned(instant, timezone, options) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, ...options }).format(new Date(instant));
}

const formatDay = (instant, timezone) => formatZoned(instant, timezone, { day: "numeric", month: "short", year: "numeric" });

// --- describing a schedule --------------------------------------------------

/** [1,2,3,4,5] → "Mon–Fri"; [6,0] → "Sat, Sun"; [] or all seven → "Every day". */
export function describeDays(days = []) {
  const set = new Set(days);
  if (!set.size || set.size === 7) return "Every day";

  const runs = [];
  for (const [index, day] of WEEKDAYS.entries()) {
    if (!set.has(day.value)) continue;
    const last = runs.at(-1);
    if (last && last.end === index - 1) last.end = index;
    else runs.push({ start: index, end: index });
  }

  return runs
    .map(({ start, end }) => {
      if (start === end) return WEEKDAYS[start].short;
      if (end === start + 1) return `${WEEKDAYS[start].short}, ${WEEKDAYS[end].short}`;
      return `${WEEKDAYS[start].short}–${WEEKDAYS[end].short}`;
    })
    .join(", ");
}

/** "Mon–Fri · 11:00–15:00", "Every day · 20:00–02:00 next day", plus a date range. */
export function describeSchedule(menu, timezone) {
  const parts = [describeDays(menu.daysOfWeek)];

  if (menu.startMinute != null && menu.endMinute != null) {
    parts.push(`${formatClock(menu.startMinute)}–${formatClock(menu.endMinute)}${menu.endMinute > 1440 ? " next day" : ""}`);
  } else {
    parts.push("all day");
  }

  if (menu.activeFrom && menu.activeTo) {
    parts.push(`${formatDay(menu.activeFrom, timezone)} to ${formatDay(menu.activeTo, timezone)}`);
  } else if (menu.activeFrom) {
    parts.push(`from ${formatDay(menu.activeFrom, timezone)}`);
  } else if (menu.activeTo) {
    parts.push(`until ${formatDay(menu.activeTo, timezone)}`);
  }

  return parts.join(" · ");
}

// --- forms ------------------------------------------------------------------

export function menuFormValues(menu = null, { timezone = "UTC", branchId = "" } = {}) {
  const window = menu?.startMinute != null && menu?.endMinute != null;
  return {
    branchId: menu?.branchId ?? branchId,
    name: menu?.name ?? "",
    type: menu?.type ?? "DINE_IN",
    description: menu?.description ?? "",
    isDefault: menu?.isDefault ?? false,
    days: menu?.daysOfWeek?.length ? [...menu.daysOfWeek] : [],
    start: window ? formatClock(menu.startMinute) : "",
    end: window ? formatClock(menu.endMinute) : "",
    from: menu?.activeFrom ? zonedDateInput(menu.activeFrom, timezone) : "",
    // Stored as the last instant of the final day, so it reads back as that day.
    to: menu?.activeTo ? zonedDateInput(menu.activeTo, timezone) : "",
  };
}

/**
 * The menu form → an API body, or field errors.
 *
 * `timezone` is the branch's. An end time at or before the start means the
 * window runs past midnight ("20:00 to 02:00"), stored as an end past 1440 —
 * the only reading of those two times that describes a real service.
 */
export function menuPayload(form, { creating = false, timezone = "UTC" } = {}) {
  const errors = {};
  const body = {};

  if (creating) {
    if (!form.branchId) errors.branchId = "Choose a branch.";
    else body.branchId = form.branchId;
  }

  const name = form.name.trim();
  if (!name) errors.name = "Give the menu a name.";
  else if (name.length > 120) errors.name = "Keep it under 120 characters.";
  else body.name = name;

  if (!MENU_TYPES.some((entry) => entry.value === form.type)) errors.type = "Choose where this menu is used.";
  else body.type = form.type;

  const description = form.description.trim();
  if (description.length > 2000) errors.description = "Keep it under 2000 characters.";
  else body.description = description || null;

  body.isDefault = Boolean(form.isDefault);

  const days = [...new Set(form.days)].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  body.daysOfWeek = days.length === 7 ? [] : days.sort((a, b) => a - b);

  const hasStart = form.start.trim() !== "";
  const hasEnd = form.end.trim() !== "";
  const start = hasStart ? parseClock(form.start) : null;
  const end = hasEnd ? parseClock(form.end) : null;
  if (hasStart && start == null) errors.start = "Use 24-hour time, e.g. 11:30.";
  if (hasEnd && end == null) errors.end = "Use 24-hour time, e.g. 15:00.";
  if (!errors.start && !errors.end) {
    if (hasStart !== hasEnd) {
      errors[hasStart ? "end" : "start"] = "Set both times, or leave both empty for all day.";
    } else if (hasStart) {
      if (start === end) errors.end = "The start and end are the same time.";
      else {
        body.startMinute = start;
        body.endMinute = end > start ? end : end + 1440;
      }
    } else {
      body.startMinute = null;
      body.endMinute = null;
    }
  }

  const from = form.from ? localMidnight(form.from, timezone) : null;
  const toStart = form.to ? localMidnight(form.to, timezone) : null;
  if (form.from && !from) errors.from = "Enter a valid date.";
  if (form.to && !toStart) errors.to = "Enter a valid date.";
  if (!errors.from && !errors.to) {
    if (from && toStart && toStart < from) errors.to = "The last day is before the first day.";
    else {
      body.activeFrom = from ? from.toISOString() : null;
      // Inclusive: the menu runs to the end of its last day.
      body.activeTo = toStart ? new Date(localMidnight(addDays(form.to, 1), timezone).getTime() - 1).toISOString() : null;
    }
  }

  return { body, errors };
}

// --- live state -------------------------------------------------------------

/**
 * Where a menu stands right now, most decisive reason first.
 *
 * `matchesNow` is whether its own schedule covers this moment; `picked` is the
 * menu the branch actually resolves to for this channel. A menu can match and
 * still not be showing — a more specific one outranks it — and that is the case
 * worth naming, because it looks exactly like a broken menu.
 */
export function menuLiveState({ menu, matchesNow, picked, now = new Date() }) {
  if (!menu.isActive) return { key: "OFF", label: "Switched off" };
  if (menu.activeTo && new Date(menu.activeTo) < now) return { key: "ENDED", label: "Ended" };
  if (menu.activeFrom && new Date(menu.activeFrom) > now) return { key: "UPCOMING", label: "Not started" };
  if (!matchesNow) return { key: "OUT_OF_HOURS", label: "Outside its hours" };
  if (picked && picked.id !== menu.id) return { key: "OUTRANKED", label: "Hidden by another menu", by: picked.name };
  return { key: "LIVE", label: "Live now" };
}

// --- items ------------------------------------------------------------------

/** Is this row something a customer could order right now, and if not, why not. */
export function menuRowState(row, now = new Date()) {
  if (row.product.deletedAt) return { key: "DELETED", orderable: false };
  if (!row.product.isActive) return { key: "DRAFT", orderable: false };
  if (!row.variant.isActive) return { key: "SIZE_OFF", orderable: false };
  const until = row.unavailableUntil ? new Date(row.unavailableUntil) : null;
  if (until) return until <= now ? { key: "AVAILABLE", orderable: true } : { key: "SOLD_OUT", orderable: false, until };
  if (!row.isAvailable) return { key: "SOLD_OUT", orderable: false, until: null };
  return { key: "AVAILABLE", orderable: true };
}

/**
 * Rows → sections of products, in the order customers see them.
 *
 * One row per size is how the menu is stored; one card per product is how it
 * is read. Rows with no section come last, as the storefront's "More".
 */
export function groupMenuProducts(items, sections) {
  const products = new Map();
  for (const row of items) {
    const key = row.productId;
    if (!products.has(key)) {
      products.set(key, {
        productId: row.productId,
        product: row.product,
        sectionId: row.sectionId,
        sortOrder: row.sortOrder,
        isRecommended: false,
        rows: [],
      });
    }
    const entry = products.get(key);
    entry.rows.push(row);
    entry.sortOrder = Math.min(entry.sortOrder, row.sortOrder);
    entry.isRecommended = entry.isRecommended || row.isRecommended;
  }

  const ordered = [...products.values()]
    .map((entry) => ({
      ...entry,
      rows: entry.rows.sort((a, b) => a.variant.sortOrder - b.variant.sortOrder || Number(a.variant.price) - Number(b.variant.price)),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.product.name.localeCompare(b.product.name));

  const known = new Set(sections.map((section) => section.id));
  const groups = [...sections]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((section) => ({ section, products: ordered.filter((entry) => entry.sectionId === section.id) }));

  const loose = ordered.filter((entry) => !entry.sectionId || !known.has(entry.sectionId));
  if (loose.length) groups.push({ section: null, products: loose });
  return groups;
}

/**
 * The whole menu's product order after moving one product within its section.
 *
 * The server takes the full order (see `reorderMenuProducts`), so the move is
 * applied to the grouped view and flattened back.
 */
export function productOrderAfterMove(groups, productId, by) {
  const next = groups.map((group) => ({ ...group, products: [...group.products] }));
  for (const group of next) {
    const index = group.products.findIndex((entry) => entry.productId === productId);
    if (index === -1) continue;
    const target = index + by;
    if (target < 0 || target >= group.products.length) return null;
    [group.products[index], group.products[target]] = [group.products[target], group.products[index]];
    break;
  }
  return next.flatMap((group) => group.products.map((entry) => entry.productId));
}

/** Sold out for every size, some sizes, or none — and when the soonest comes back. */
export function productAvailability(rows, now = new Date()) {
  const states = rows.map((row) => menuRowState(row, now));
  const soldOut = states.filter((state) => state.key === "SOLD_OUT");
  const offered = states.filter((state) => state.key === "AVAILABLE" || state.key === "SOLD_OUT");
  const untils = soldOut.map((state) => state.until).filter(Boolean);
  const until = untils.length === soldOut.length && untils.length ? new Date(Math.max(...untils.map(Number))) : null;
  if (!offered.length) return { key: "NOT_OFFERED", until: null };
  if (soldOut.length === offered.length) return { key: "SOLD_OUT", until };
  if (soldOut.length) return { key: "PARTLY", until: null };
  return { key: "AVAILABLE", until: null };
}

/** A menu price field: blank means "use the product's own price". */
export function priceOverridePayload(input) {
  const parsed = parseMoney(input);
  return parsed.error ? { value: null, error: parsed.error } : { value: parsed.value, error: null };
}

/**
 * Problems with a menu as customers would meet it.
 *
 * Only what the menu itself decides: a product that is a draft is flagged
 * because it sits on this menu doing nothing, not because drafts are wrong.
 */
export function menuHealth({ menu, sections = [], items = [], now = new Date() }) {
  const issues = [];
  const states = items.map((row) => ({ row, state: menuRowState(row, now) }));

  if (!items.length) {
    issues.push({ level: "blocking", message: "Nothing is on this menu yet, so customers would see an empty menu." });
    return issues;
  }

  const hiddenSections = sections.filter((section) => !section.isActive);
  const inHidden = new Set(hiddenSections.map((section) => section.id));
  const visible = states.filter(({ row, state }) => state.orderable && !inHidden.has(row.sectionId));
  if (!visible.length) {
    issues.push({ level: "blocking", message: "Every item is hidden, sold out or unpublished, so customers can order nothing." });
  }

  for (const section of hiddenSections) {
    const count = new Set(items.filter((row) => row.sectionId === section.id).map((row) => row.productId)).size;
    if (count) {
      issues.push({
        level: "warning",
        message: `“${section.name}” is switched off, so its ${count} ${count === 1 ? "product is" : "products are"} hidden.`,
      });
    }
  }

  const drafts = new Set(states.filter(({ state }) => state.key === "DRAFT").map(({ row }) => row.product.name));
  if (drafts.size) {
    issues.push({
      level: "warning",
      message: `${[...drafts].slice(0, 3).join(", ")}${drafts.size > 3 ? ` and ${drafts.size - 3} more` : ""} ${drafts.size === 1 ? "is" : "are"} unpublished, so ${drafts.size === 1 ? "it does" : "they do"} not show.`,
    });
  }

  if (menu.activeTo && new Date(menu.activeTo) < now) {
    issues.push({ level: "warning", message: "Its date range has ended, so it no longer shows." });
  }

  return issues;
}

// --- stations ---------------------------------------------------------------

export function stationFormValues(station = null) {
  return { name: station?.name ?? "", code: station?.code ?? "", printerId: station?.printerId ?? "" };
}

export function stationPayload(form) {
  const errors = {};
  const body = {};

  const name = form.name.trim();
  if (!name) errors.name = "Give the station a name.";
  else if (name.length > 120) errors.name = "Keep it under 120 characters.";
  else body.name = name;

  const code = form.code.trim().toUpperCase();
  if (!code) errors.code = "Give it a short code.";
  else if (!/^[A-Z0-9_-]{2,20}$/.test(code)) errors.code = "2–20 letters, digits, hyphens or underscores.";
  else body.code = code;

  const printerId = form.printerId.trim();
  if (printerId.length > 120) errors.printerId = "Keep it under 120 characters.";
  else body.printerId = printerId || null;

  return { body, errors };
}
