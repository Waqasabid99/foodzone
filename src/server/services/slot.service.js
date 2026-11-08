import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { getSettings } from "@/server/services/setting.service";
import { buildSlots, findSlot, schedulableDates } from "@/server/ordering/slots";
import { zonedInstant } from "@/lib/menu-schedule";

/**
 * Scheduled orders: the database half.
 *
 * The grid itself is pure and lives in `src/server/ordering/slots.js`. This
 * fetches the three things it cannot work out on its own — the branch's hours,
 * its closures, and how many orders already hold each slot — and turns a
 * refusal into an error a customer can act on.
 *
 * Statuses that count toward a slot's ceiling are the ones that still owe
 * food. A cancelled pre-order has to give its place back, or a slot fills up
 * permanently the first time somebody changes their mind.
 */
const HOLDS_A_SLOT = ["PENDING", "CONFIRMED", "PREPARING", "READY"];

/** The settings scheduling reads, with their defaults applied. */
async function scheduleConfig(branchId) {
  const settings = await getSettings({ branchId });

  return {
    maxDaysAhead: Number(settings["ordering.max_scheduled_days_ahead"] ?? 7),
    slotMinutes: Number(settings["ordering.slot_minutes"] ?? 30),
    capacity: Number(settings["ordering.slot_capacity"] ?? 0),
    // The same floor the kitchen already promises on an ASAP order: a slot
    // sooner than the food can be made is not a slot.
    leadMinutes: Number(settings["ordering.default_prep_minutes"] ?? 30),
  };
}

async function branchFor(branchId) {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { id: true, isActive: true, timezone: true },
  });
  if (!branch) throw ApiError.notFound("Branch not found");
  return branch;
}

/**
 * How many live orders hold each slot on a day.
 *
 * Grouped in the database rather than counted in memory: a busy branch has
 * thousands of orders and this runs on every page load of the checkout.
 *
 * The window is bound as a parameter rather than built into SQL with `now()`.
 * `scheduledFor` is `timestamp without time zone` holding UTC, and comparing
 * one against a real instant makes Postgres reinterpret the column in the
 * session's timezone — only one side moves, and on a non-UTC server the counts
 * come out shifted by the offset.
 */
async function slotCounts({ branchId, from, to }) {
  const rows = await prisma.order.groupBy({
    by: ["scheduledFor"],
    where: { branchId, status: { in: HOLDS_A_SLOT }, scheduledFor: { gte: from, lt: to } },
    _count: { _all: true },
  });

  return new Map(rows.filter((row) => row.scheduledFor).map((row) => [new Date(row.scheduledFor).toISOString(), row._count._all]));
}

/** The grid for one local date at one branch. */
export async function slotsForDate({ branchId, date, channel = null, now = new Date() }) {
  const branch = await branchFor(branchId);
  const config = await scheduleConfig(branchId);
  const timeZone = branch.timezone ?? "UTC";

  const dates = schedulableDates({ now, timeZone, maxDaysAhead: config.maxDaysAhead });
  const wanted = date ?? dates[0];

  if (!dates.includes(wanted)) {
    throw ApiError.validation("That date is not open for scheduling", {
      date: [`Choose a date between ${dates[0]} and ${dates.at(-1)}`],
    });
  }

  const from = zonedInstant(wanted, 0, timeZone);
  // Two days wide, because a window that runs past midnight puts its late
  // slots on the following calendar day.
  const to = new Date(from.getTime() + 2 * 86_400_000);

  const [hours, closures, counts] = await Promise.all([
    prisma.branchHour.findMany({
      where: { branchId },
      select: { dayOfWeek: true, opensAt: true, closesAt: true, channel: true },
    }),
    prisma.branchClosure.findMany({
      where: { branchId, endsAt: { gt: from }, startsAt: { lt: to } },
      select: { startsAt: true, endsAt: true, reason: true },
    }),
    slotCounts({ branchId, from, to }),
  ]);

  const grid = buildSlots({
    date: wanted,
    timeZone,
    hours,
    closures,
    now,
    slotMinutes: config.slotMinutes,
    leadMinutes: config.leadMinutes,
    capacity: config.capacity,
    counts,
    channel,
  });

  return {
    branchId,
    timeZone,
    dates,
    maxDaysAhead: config.maxDaysAhead,
    // A branch that has never had its hours set has no grid at all, and
    // "closed every day" is a confusing way to say "nobody filled this in".
    hoursConfigured: hours.length > 0,
    ...grid,
  };
}

/**
 * Validates a requested slot at checkout, and returns the instant to store.
 *
 * Re-derived from the branch's hours rather than trusting what the browser
 * sent: the page may have been open for an hour, the slot may have filled
 * since, and the request can arrive without the page ever being loaded.
 *
 * `null` in, `null` out — an order with no slot is an ASAP order, which is
 * almost all of them.
 */
export async function resolveScheduledSlot({ branchId, scheduledFor, channel = null, now = new Date() }) {
  if (!scheduledFor) return null;

  const at = new Date(scheduledFor);
  if (Number.isNaN(at.getTime())) {
    throw ApiError.validation("That is not a valid time", { scheduledFor: ["Choose a slot"] });
  }

  const branch = await branchFor(branchId);
  const timeZone = branch.timezone ?? "UTC";

  // The slot's own local date, which is the grid it has to appear in — and for
  // a past-midnight slot that is the previous day's grid, because that is the
  // trading day it belongs to.
  const grid = await slotsForDate({ branchId, date: localDateOf(at, timeZone), channel, now });
  let verdict = findSlot(at, grid);

  if (!verdict.ok) {
    const previous = await slotsForDate({
      branchId,
      date: shiftDate(localDateOf(at, timeZone), -1),
      channel,
      now,
    }).catch(() => null);
    if (previous) {
      const alsoTried = findSlot(at, previous);
      if (alsoTried.ok) verdict = alsoTried;
    }
  }

  if (!verdict.ok) throw refusal(verdict.reason, grid);
  return at;
}

/** Turns a machine reason into something a customer can act on. */
function refusal(reason, grid) {
  const open = (grid.slots ?? []).filter((slot) => slot.available).slice(0, 3).map((slot) => slot.label);
  const suggestion = open.length ? ` Try ${open.join(", ")}.` : "";

  switch (reason) {
    case "SLOT_FULL":
      return ApiError.conflict(`That time is fully booked.${suggestion}`, { scheduledFor: ["Choose another slot"] });
    case "CLOSED":
      return ApiError.validation("The branch is closed then", { scheduledFor: ["Choose a day the branch is open"] });
    case "NO_SLOTS_LEFT":
      return ApiError.conflict("There are no slots left that day", { scheduledFor: ["Choose another day"] });
    default:
      return ApiError.validation(`That is not an available slot.${suggestion}`, {
        scheduledFor: ["Choose one of the offered times"],
      });
  }
}

function localDateOf(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  return parts;
}

function shiftDate(dateInput, days) {
  const [year, month, day] = String(dateInput).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
