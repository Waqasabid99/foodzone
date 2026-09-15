import { prisma } from "@/lib/prisma";
import { ApiError, cursorArgs, toPage } from "@/lib/api";

/**
 * Branches, their opening hours, and whether they are open right now.
 *
 * Opening hours are stored as minutes from midnight in the branch's own
 * timezone, and a closing time may exceed 1440 to express service past midnight
 * (20:00–02:00 is `opensAt: 1200, closesAt: 1560`). Everything below works in
 * that arithmetic rather than in Date objects, because Date arithmetic across a
 * DST boundary silently shifts opening times by an hour.
 */

const BRANCH_SELECT = {
  id: true,
  code: true,
  name: true,
  legalName: true,
  taxIdentifier: true,
  phone: true,
  email: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  country: true,
  postalCode: true,
  latitude: true,
  longitude: true,
  timezone: true,
  currency: true,
  deliveryRadiusKm: true,
  isActive: true,
  openedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
};

/** Day of week and minutes-from-midnight, as seen in the branch's timezone. */
export function zonedNow(timezone, at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);

  const value = (type) => parts.find((part) => part.type === type)?.value;
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  // "24" appears at midnight in some locales' 24-hour formatting.
  const hour = Number(value("hour")) % 24;
  const minute = Number(value("minute"));

  return { dayOfWeek: weekdays[value("weekday")] ?? 0, minutes: hour * 60 + minute };
}

function minutesToLabel(minutes) {
  const normalised = ((minutes % 1440) + 1440) % 1440;
  const hour = String(Math.floor(normalised / 60)).padStart(2, "0");
  const minute = String(normalised % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

/**
 * Is the branch serving at `at`?
 *
 * Checks today's windows, then yesterday's windows that run past midnight, then
 * any one-off closure covering the instant.
 */
export function computeOpenState({ branch, hours, closures = [], channel = null, at = new Date() }) {
  if (!branch.isActive) return { isOpen: false, reason: "INACTIVE", nextOpenAt: null };

  const closure = closures.find((item) => item.startsAt <= at && item.endsAt >= at);
  if (closure) {
    return { isOpen: false, reason: "CLOSURE", closureReason: closure.reason ?? null, nextOpenAt: closure.endsAt };
  }

  const { dayOfWeek, minutes } = zonedNow(branch.timezone, at);
  // A row with no channel applies to every channel.
  const relevant = hours.filter((row) => row.channel === null || row.channel === channel);

  const openToday = relevant.some(
    (row) => row.dayOfWeek === dayOfWeek && minutes >= row.opensAt && minutes < row.closesAt,
  );
  if (openToday) return { isOpen: true, reason: "OPEN", nextOpenAt: null };

  // Yesterday's late window: 01:00 today falls inside yesterday's 20:00–02:00.
  const yesterday = (dayOfWeek + 6) % 7;
  const openFromYesterday = relevant.some(
    (row) => row.dayOfWeek === yesterday && row.closesAt > 1440 && minutes + 1440 >= row.opensAt && minutes + 1440 < row.closesAt,
  );
  if (openFromYesterday) return { isOpen: true, reason: "OPEN", nextOpenAt: null };

  return {
    isOpen: false,
    reason: relevant.length ? "OUTSIDE_HOURS" : "NO_HOURS_SET",
    nextOpenAt: nextOpening({ relevant, dayOfWeek, minutes, timezone: branch.timezone, at }),
  };
}

/** The next opening instant, scanning at most a week ahead. */
function nextOpening({ relevant, dayOfWeek, minutes, at }) {
  if (!relevant.length) return null;

  for (let offset = 0; offset < 8; offset += 1) {
    const day = (dayOfWeek + offset) % 7;
    const candidates = relevant
      .filter((row) => row.dayOfWeek === day)
      .map((row) => row.opensAt)
      .filter((opensAt) => offset > 0 || opensAt > minutes)
      .sort((a, b) => a - b);

    if (candidates.length) {
      const minutesUntil = offset * 1440 + candidates[0] - minutes;
      return new Date(at.getTime() + minutesUntil * 60_000);
    }
  }

  return null;
}

async function loadOpenState(branch, { channel = null, at = new Date() } = {}) {
  const [hours, closures] = await Promise.all([
    prisma.branchHour.findMany({ where: { branchId: branch.id } }),
    prisma.branchClosure.findMany({
      where: { branchId: branch.id, endsAt: { gte: at } },
      orderBy: { startsAt: "asc" },
    }),
  ]);

  return { hours, closures, state: computeOpenState({ branch, hours, closures, channel, at }) };
}

function withHourLabels(hours) {
  return hours
    .slice()
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.opensAt - b.opensAt)
    .map((row) => ({
      id: row.id,
      dayOfWeek: row.dayOfWeek,
      opensAt: row.opensAt,
      closesAt: row.closesAt,
      opensAtLabel: minutesToLabel(row.opensAt),
      closesAtLabel: minutesToLabel(row.closesAt),
      // Makes a past-midnight window obvious to a UI without re-deriving it.
      overnight: row.closesAt > 1440,
      channel: row.channel,
    }));
}

export async function listBranches({ search, isActive, limit = 20, cursor, includeState = false, channel = null }) {
  const rows = await prisma.branch.findMany({
    where: {
      ...(isActive !== undefined ? { isActive } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { code: { contains: search, mode: "insensitive" } },
              { city: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: BRANCH_SELECT,
    orderBy: { name: "asc" },
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);
  if (!includeState) return page;

  // One query for every branch's hours rather than one per branch.
  const ids = page.items.map((branch) => branch.id);
  const at = new Date();
  const [hours, closures] = await Promise.all([
    prisma.branchHour.findMany({ where: { branchId: { in: ids } } }),
    prisma.branchClosure.findMany({ where: { branchId: { in: ids }, endsAt: { gte: at } } }),
  ]);

  return {
    ...page,
    items: page.items.map((branch) => {
      const branchHours = hours.filter((row) => row.branchId === branch.id);
      return {
        ...branch,
        hours: withHourLabels(branchHours),
        openState: computeOpenState({
          branch,
          hours: branchHours,
          closures: closures.filter((row) => row.branchId === branch.id),
          channel,
          at,
        }),
      };
    }),
  };
}

export async function getBranch(idOrCode, { channel = null } = {}) {
  const branch = await prisma.branch.findFirst({
    where: { OR: [{ id: idOrCode }, { code: idOrCode }] },
    select: BRANCH_SELECT,
  });
  if (!branch) throw ApiError.notFound("Branch not found");

  const { hours, closures, state } = await loadOpenState(branch, { channel });
  return { ...branch, hours: withHourLabels(hours), closures, openState: state };
}

export async function createBranch(data, actor) {
  const existing = await prisma.branch.findUnique({ where: { code: data.code }, select: { id: true } });
  if (existing) throw ApiError.conflict(`A branch with code "${data.code}" already exists`);

  const branch = await prisma.branch.create({ data, select: BRANCH_SELECT });
  return getBranch(branch.id);
}

export async function updateBranch(id, data) {
  const branch = await prisma.branch.findUnique({ where: { id }, select: { id: true } });
  if (!branch) throw ApiError.notFound("Branch not found");

  if (data.code) {
    const clash = await prisma.branch.findFirst({
      where: { code: data.code, id: { not: id } },
      select: { id: true },
    });
    if (clash) throw ApiError.conflict(`A branch with code "${data.code}" already exists`);
  }

  await prisma.branch.update({ where: { id }, data });
  return getBranch(id);
}

/**
 * Replaces the whole week's hours in one transaction.
 *
 * Replace rather than merge: editing hours is inherently "here is the new
 * schedule", and a partial update leaves yesterday's window alive by accident.
 */
export async function setBranchHours({ branchId, hours }) {
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } });
  if (!branch) throw ApiError.notFound("Branch not found");

  for (const row of hours) {
    if (row.closesAt <= row.opensAt) {
      throw ApiError.validation("Closing time must be after opening time", {
        hours: [`Day ${row.dayOfWeek}: use minutes past 1440 for a window that runs past midnight`],
      });
    }
  }

  await prisma.$transaction([
    prisma.branchHour.deleteMany({ where: { branchId } }),
    prisma.branchHour.createMany({ data: hours.map((row) => ({ ...row, branchId })) }),
  ]);

  const saved = await prisma.branchHour.findMany({ where: { branchId } });
  return withHourLabels(saved);
}

export async function listClosures({ branchId, upcomingOnly = true }) {
  return prisma.branchClosure.findMany({
    where: { branchId, ...(upcomingOnly ? { endsAt: { gte: new Date() } } : {}) },
    orderBy: { startsAt: "asc" },
  });
}

export async function createClosure({ branchId, startsAt, endsAt, reason, actorId }) {
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } });
  if (!branch) throw ApiError.notFound("Branch not found");
  if (endsAt <= startsAt) {
    throw ApiError.validation("The closure must end after it starts", { endsAt: ["Must be after startsAt"] });
  }

  return prisma.branchClosure.create({
    data: { branchId, startsAt, endsAt, reason, createdById: actorId },
  });
}

export async function deleteClosure({ branchId, closureId }) {
  const closure = await prisma.branchClosure.findFirst({ where: { id: closureId, branchId } });
  if (!closure) throw ApiError.notFound("Closure not found");

  await prisma.branchClosure.delete({ where: { id: closureId } });
  return { deleted: true };
}

/** What the storefront and the app show: active branches with their open state. */
export async function publicBranches({ channel = null } = {}) {
  const { items } = await listBranches({ isActive: true, limit: 100, includeState: true, channel });

  return items.map((branch) => ({
    id: branch.id,
    code: branch.code,
    name: branch.name,
    phone: branch.phone,
    addressLine1: branch.addressLine1,
    addressLine2: branch.addressLine2,
    city: branch.city,
    state: branch.state,
    country: branch.country,
    postalCode: branch.postalCode,
    latitude: branch.latitude,
    longitude: branch.longitude,
    timezone: branch.timezone,
    currency: branch.currency,
    deliveryRadiusKm: branch.deliveryRadiusKm,
    hours: branch.hours,
    openState: branch.openState,
  }));
}
