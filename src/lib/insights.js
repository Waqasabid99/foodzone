import { dateLabel, lastMonth, monthToDate, timeLabel, toDateInput } from "@/lib/finance";

export { dateLabel, lastMonth, monthToDate, timeLabel, toDateInput };

/**
 * The reporting screens' vocabulary, with no React and no database in it.
 *
 * Reports are the one part of the dashboard where the risk is not a wrong
 * number but a **misread** one. A figure with no denominator, a percentage
 * with no base, a chart with no stated range — each is correct and useless,
 * and the useless kind is worse than an error because nobody notices. So most
 * of what is here exists to make a figure say what it is: what it counts,
 * what it excludes, and how much of it there is to trust.
 */

/**
 * The reports, each behind its own permission.
 *
 * `reports.view_creator` is deliberately absent. The creator programme is
 * deferred, and listing a report that cannot be opened is worse than not
 * listing it — the hub says so in its empty state instead.
 */
export const REPORTS = [
  {
    key: "sales",
    label: "Sales",
    permission: "reports.view_sales",
    blurb: "What was sold, through which channel, and when.",
    excludes: "Completed orders only — a cancelled order is not a sale, and a pending one is not yet.",
  },
  {
    key: "product-mix",
    label: "Product mix",
    permission: "reports.view_sales",
    blurb: "Which dishes sell, and which of those actually make money.",
    excludes: "Margin is shown only where a recipe gives the dish a cost.",
  },
  {
    key: "inventory",
    label: "Inventory",
    permission: "reports.view_inventory",
    blurb: "What is on the shelves and what it is worth.",
    excludes: "A position as at now, not a period — stock has no 'between two dates'.",
  },
  {
    key: "delivery",
    label: "Delivery",
    permission: "reports.view_delivery",
    blurb: "How long deliveries take, and who is carrying them.",
    excludes: "On-time is measured against the promised time, on completed jobs only.",
  },
  {
    key: "attendance",
    label: "Attendance",
    permission: "reports.view_hr",
    blurb: "Days worked, days off and days nobody has approved.",
    excludes: "The month as payroll will read it, per employee.",
  },
];

export const reportByKey = (key) => REPORTS.find((report) => report.key === key) ?? null;

// --- time ranges ------------------------------------------------------------

/**
 * How a series is bucketed, and what each choice is good for.
 *
 * Offered rather than inferred from the range, because the right bucket is a
 * question about what you are looking for and not about how long the window
 * is: a fortnight by hour answers "when is the rush", a fortnight by day
 * answers "which days are quiet", and they are different questions.
 */
export const GROUPINGS = [
  { value: "day", label: "By day" },
  { value: "hour", label: "By hour" },
  { value: "month", label: "By month" },
];

export const isGrouping = (value) => GROUPINGS.some((row) => row.value === value);

/** The last seven whole days, which is what a sales report usually wants. */
export function lastWeek(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7));
  return { from: toDateInput(start), to: toDateInput(end) };
}

/**
 * A bucket key turned into something a human reads.
 *
 * The keys are ISO prefixes — `2026-10`, `2026-10-03`, `2026-10-03T14` — so
 * the granularity is readable off the key's own length rather than passed
 * alongside it and getting out of step with the data.
 */
export function bucketLabel(period, { long = false } = {}) {
  const text = String(period ?? "");

  if (text.length === 7) {
    const date = new Date(`${text}-01T00:00:00Z`);
    return date.toLocaleDateString(undefined, { month: long ? "long" : "short", year: "numeric", timeZone: "UTC" });
  }
  if (text.length === 13) {
    const date = new Date(`${text}:00:00Z`);
    return long
      ? date.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", timeZone: "UTC" })
      : date.toLocaleString(undefined, { hour: "numeric", timeZone: "UTC" });
  }
  if (text.length === 10) {
    const date = new Date(`${text}T00:00:00Z`);
    return date.toLocaleDateString(undefined, {
      ...(long ? { weekday: "short" } : {}),
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  }
  return text || "—";
}

/**
 * Gaps filled in, so a quiet day is a quiet day rather than a missing one.
 *
 * A series built only from the buckets that have data draws a line straight
 * across a closed Monday, which reads as "steady" when the truth is "shut".
 * Only days are filled: an hour bucket is already explicitly chosen, and
 * filling months would invent rows nobody asked about.
 */
export function fillDays(series, { from, to } = {}) {
  if (!from || !to) return series;
  const start = new Date(`${String(from).slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${String(to).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return series;

  // A guard against an accidental decade: nobody reads 4,000 bars.
  const days = Math.round((end - start) / 86_400_000);
  if (days > 400) return series;

  const found = new Map(series.map((row) => [row.period, row]));
  const filled = [];
  for (let i = 0; i <= days; i++) {
    const key = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    filled.push(found.get(key) ?? { period: key, orders: 0, revenue: "0.00" });
  }
  return filled;
}

// --- reading a figure honestly ----------------------------------------------

/**
 * Whether a percentage is worth printing at all.
 *
 * "100% on time" off two deliveries is noise wearing a number's clothes, and
 * it is the figure most likely to be quoted in a meeting. Below the floor the
 * count is shown instead of the rate.
 */
export function rateIsMeaningful(count, floor = 5) {
  return typeof count === "number" && count >= floor;
}

/** A share of a total, as a rounded percentage. Null when there is no total. */
export function shareOf(value, total) {
  const base = Number(total ?? 0);
  if (!base) return null;
  const ratio = (Number(value ?? 0) / base) * 100;
  return Number.isFinite(ratio) ? Math.round(ratio * 10) / 10 : null;
}

/**
 * How an on-time percentage should read.
 *
 * Deliberately not a traffic light on an arbitrary threshold: the tone only
 * separates "comfortable" from "worth looking at", and the words carry the
 * rest. A number that is coloured red at 89% and green at 90% teaches people
 * to watch the colour instead of the trend.
 */
export function onTimeTone(percent, { count = 0 } = {}) {
  if (percent == null || !rateIsMeaningful(count)) {
    return { tone: "text-on-surface-variant", note: `Too few to read a rate from — ${count} completed.` };
  }
  if (percent >= 90) return { tone: "text-on-surface", note: "Comfortable." };
  if (percent >= 75) return { tone: "text-warning", note: "Slipping. Worth watching which drivers or which hours." };
  return { tone: "text-error", note: "One in four is late. Something is wrong with the promise or the kitchen." };
}

/** Order types and channels, in words rather than enum shouting. */
export const ORDER_TYPES = { DELIVERY: "Delivery", PICKUP: "Collection", DINE_IN: "Dine in" };
export const ORDER_CHANNELS = { WEB: "Website", MOBILE_APP: "App", POS: "Counter", PHONE: "Phone", QR: "QR code", AGGREGATOR: "Aggregator" };

export const typeLabel = (value) => ORDER_TYPES[value] ?? value ?? "Unknown";
export const channelLabel = (value) => ORDER_CHANNELS[value] ?? value ?? "Unknown";

/**
 * Rows for a magnitude chart, largest first, with a tail folded into "Other".
 *
 * Eight bars is about where a comparison stops being readable. The ninth is
 * never given its own hue — the chart is one hue by design — it is folded in,
 * and the fold is labelled so nobody thinks the list is complete.
 */
export function topRows(rows, { limit = 8, label, value, meta = null } = {}) {
  const mapped = rows.map((row) => ({
    label: label(row),
    value: Number(value(row) ?? 0),
    ...(meta ? { meta: meta(row) } : {}),
  }));
  mapped.sort((a, b) => b.value - a.value);

  if (mapped.length <= limit) return mapped;

  const head = mapped.slice(0, limit);
  const tail = mapped.slice(limit);
  const rest = tail.reduce((sum, row) => sum + row.value, 0);
  return [...head, { label: `Other (${tail.length})`, value: rest, meta: "everything below the top few, added up" }];
}

// --- the audit log ----------------------------------------------------------

/**
 * An action key turned into a sentence.
 *
 * The keys are `thing.verb`, and rendering them raw makes a compliance screen
 * read like a log file. The mapping is deliberately mechanical rather than an
 * exhaustive table: there are dozens of actions and a hand-written list would
 * fall behind the first time somebody added one.
 */
const VERBS = {
  create: "created",
  update: "updated",
  delete: "deleted",
  approve: "approved",
  reject: "rejected",
  cancel: "cancelled",
  void: "voided",
  post: "posted",
  reverse: "reversed",
  publish: "published",
  assign: "assigned",
  unassign: "unassigned",
  close: "closed",
  reopen: "reopened",
  lock: "locked",
  capture: "captured",
  collect: "collected",
  refund: "refunded",
  paid: "marked paid",
  login: "signed in",
  logout: "signed out",
};

export function actionSentence(action) {
  const text = String(action ?? "");
  const dot = text.lastIndexOf(".");
  if (dot === -1) return text || "did something";

  const subject = text.slice(0, dot).replace(/[._]/g, " ");
  const verb = text.slice(dot + 1);
  return `${VERBS[verb] ?? verb.replace(/_/g, " ")} a ${subject}`;
}

/** The modules present in a set of action keys, for a grouped filter. */
export function actionGroups(actions) {
  const groups = new Map();
  for (const action of actions) {
    const key = String(action).split(".")[0];
    if (!key) continue;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups.entries()]
    .map(([key, count]) => ({ key, label: key.replace(/_/g, " "), count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Which audit actions destroy or move money, for the eye to land on.
 *
 * Not a severity score — a log where everything is ranked is a log nobody
 * reads. Only two categories: the irreversible ones, and everything else.
 */
const WEIGHTY = /\.(delete|void|reverse|refund|approve|lock|reopen|cancel)$/;
export const isWeighty = (action) => WEIGHTY.test(String(action ?? ""));

/**
 * What changed, flattened into readable lines.
 *
 * `changes` is free-form JSON written by whatever recorded the entry, so this
 * takes what it finds rather than assuming a shape. Anything that looks like
 * a secret is dropped: an audit log is read by more people than the record it
 * describes, and a token in a log is a token in a screenshot.
 */
const SECRET = /(password|secret|token|hash|otp|key|signature)/i;

export function changeLines(changes) {
  if (!changes || typeof changes !== "object") return [];

  return Object.entries(changes)
    .filter(([key]) => !SECRET.test(key))
    .map(([key, value]) => ({
      field: key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[._]/g, " ").toLowerCase(),
      value:
        value === null || value === undefined
          ? "—"
          : typeof value === "object"
            ? JSON.stringify(value).slice(0, 160)
            : String(value).slice(0, 160),
    }))
    .slice(0, 12);
}

/** Who did it, when there may be no signed-in person behind an entry. */
export const actorName = (log) => log?.actor?.name ?? (log?.actorId ? "A deleted account" : "The system");
