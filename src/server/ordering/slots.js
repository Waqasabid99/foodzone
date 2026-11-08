import { zonedInstant, zonedParts } from "@/lib/menu-schedule";

/**
 * Pickup and delivery slots for a future day.
 *
 * A customer ordering for tonight is not choosing a time, they are choosing a
 * *slot*, and the difference is the whole point. Left to name any minute they
 * like, forty people choose 19:00 on a Friday and the kitchen is handed forty
 * tickets at once with no way to have said no. A slot has a ceiling, so the
 * eleventh order for 19:00 is offered 19:30 before it is taken, rather than
 * being apologised for afterwards.
 *
 * The rules, each of which is a way this goes wrong in a real shop:
 *
 *   * **Slots come from the branch's own trading hours**, including the
 *     past-midnight ones. A kitchen that closes at 02:00 can take a 01:30
 *     order; one that closes at 22:00 cannot.
 *   * **The last slot is a whole slot before closing.** Offering 21:55 to a
 *     kitchen that shuts at 22:00 promises food nobody will cook.
 *   * **Nothing inside the lead time.** Preparation takes as long as it takes,
 *     so a slot sooner than `now + leadMinutes` is not offered at all — not
 *     offered-and-rejected, which teaches a customer to try again.
 *   * **A closure removes its slots**, because a branch shut for a wedding is
 *     shut whatever its weekly hours say.
 *   * **A full slot is still shown.** Hiding it reads as "no slots"; showing
 *     it with nothing left reads as "that one is taken, pick another", and a
 *     customer who can see the shape of the evening picks a workable time.
 *
 * Pure, and every instant is computed through `zonedInstant`, so the arithmetic
 * is the branch's wall clock rather than the server's.
 */

/** Slot sizes a customer can reason about. */
export const SLOT_MINUTES = 30;

/** 0 means a branch has set no ceiling and every slot is open. */
export const UNLIMITED = 0;

/**
 * Builds the grid for one local date.
 *
 * `counts` maps a slot's ISO string to how many orders already hold it, which
 * is the one input that has to come from the database.
 */
export function buildSlots({
  date,
  timeZone = "UTC",
  hours = [],
  closures = [],
  now = new Date(),
  slotMinutes = SLOT_MINUTES,
  leadMinutes = 0,
  capacity = UNLIMITED,
  counts = new Map(),
  channel = null,
} = {}) {
  const midnight = zonedInstant(date, 0, timeZone);
  if (!midnight) return { date, slots: [], reason: "INVALID_DATE" };

  const size = Math.max(5, Number(slotMinutes) || SLOT_MINUTES);
  const dayOfWeek = zonedParts(timeZone, midnight).dayOfWeek;

  // A window declared for this channel wins; one declared for every channel is
  // the fallback. A branch that takes web orders for a shorter day than it
  // serves walk-ins is normal.
  const windows = hours.filter((row) => row.dayOfWeek === dayOfWeek && (row.channel == null || row.channel === channel));
  if (!windows.length) return { date, slots: [], reason: "CLOSED" };

  const earliest = new Date(now.getTime() + Math.max(0, Number(leadMinutes) || 0) * 60_000);
  const slots = [];
  const seen = new Set();

  for (const window of windows) {
    const opensAt = Number(window.opensAt ?? 0);
    const closesAt = Number(window.closesAt ?? 0);
    if (!(closesAt > opensAt)) continue;

    // `closesAt - size`, inclusive: the last slot has a full slot of kitchen
    // time behind it.
    for (let minutes = opensAt; minutes + size <= closesAt; minutes += size) {
      const at = zonedInstant(date, minutes, timeZone);
      if (!at) continue;

      const key = at.toISOString();
      // Two overlapping windows (a lunch and a dinner service that touch) must
      // not produce the same slot twice.
      if (seen.has(key)) continue;
      seen.add(key);

      if (at < earliest) continue;
      if (closures.some((closure) => at >= new Date(closure.startsAt) && at < new Date(closure.endsAt))) continue;

      const booked = Number(counts.get(key) ?? 0);
      const limit = Math.max(0, Number(capacity) || UNLIMITED);

      slots.push({
        at,
        label: clockLabel(minutes),
        capacity: limit || null,
        booked,
        remaining: limit ? Math.max(0, limit - booked) : null,
        available: limit ? booked < limit : true,
      });
    }
  }

  slots.sort((a, b) => a.at - b.at);
  return { date, slotMinutes: size, slots, reason: slots.length ? null : "NO_SLOTS_LEFT" };
}

/**
 * Finds the slot an instant belongs to, or says why it does not belong to one.
 *
 * Checkout calls this rather than trusting the grid the browser was shown: the
 * page may have been open for an hour, the slot may have filled since, and a
 * request can be made without ever loading the page at all.
 */
export function findSlot(at, grid) {
  if (!at || Number.isNaN(new Date(at).getTime())) return { ok: false, reason: "INVALID_TIME" };

  const wanted = new Date(at).toISOString();
  const slot = (grid.slots ?? []).find((candidate) => candidate.at.toISOString() === wanted);

  if (!slot) return { ok: false, reason: grid.reason ?? "NOT_A_SLOT" };
  if (!slot.available) return { ok: false, reason: "SLOT_FULL", slot };
  return { ok: true, slot };
}

/** Minutes past midnight as a clock, past-midnight times included. */
function clockLabel(minutes) {
  const normalised = ((Number(minutes) % 1440) + 1440) % 1440;
  const hour = Math.floor(normalised / 60);
  const minute = normalised % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * The dates a customer may choose from.
 *
 * Today counts as a day even when every slot on it has passed — the grid for
 * today then comes back empty with a reason, which is a better answer than
 * today being missing from the calendar.
 */
export function schedulableDates({ now = new Date(), timeZone = "UTC", maxDaysAhead = 7 } = {}) {
  const days = Math.max(0, Math.min(60, Number(maxDaysAhead) || 0));
  const dates = [];

  for (let offset = 0; offset <= days; offset += 1) {
    const at = new Date(now.getTime() + offset * 86_400_000);
    const parts = zonedParts(timeZone, at);
    dates.push(`${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`);
  }

  return dates;
}
