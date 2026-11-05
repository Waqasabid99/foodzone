import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { recordAudit } from "@/server/utils/audit";
import { hashToken, shortCode, verifyToken } from "@/server/utils/crypto";
import { logger } from "@/lib/logger";
import { branchFilter } from "@/server/hr/access";

/**
 * Attendance terminals.
 *
 * A device is an unattended box on a wall that talks to this API, so it gets
 * the same treatment as any other machine credential:
 *
 *   * **The API key is shown once and stored hashed.** A key readable from the
 *     admin screen is a key that ends up in somebody's notes, and a device
 *     credential can post attendance for every employee at that branch.
 *   * **Health is derived, not reported.** A device that has stopped syncing
 *     does not announce it — it goes quiet, which looks exactly like a quiet
 *     shift. `staleAfterMinutes` turns silence into a visible OFFLINE.
 *   * **The sync cursor belongs to the device row.** Terminals keep a local
 *     buffer and replay it; remembering how far we got is what stops a re-sync
 *     re-ingesting a month of punches.
 */

const SELECT = {
  id: true,
  branchId: true,
  name: true,
  serialNumber: true,
  vendor: true,
  model: true,
  ipAddress: true,
  timezone: true,
  status: true,
  lastSyncAt: true,
  lastLogCursor: true,
  isActive: true,
  createdAt: true,
  branch: { select: { id: true, name: true, code: true } },
  _count: { select: { punches: true } },
};

/** A device quiet for this long is treated as offline. */
export const STALE_AFTER_MINUTES = 30;

function shape(device, { staleAfterMinutes = STALE_AFTER_MINUTES } = {}) {
  const { _count, ...row } = device;

  const silentMinutes = row.lastSyncAt ? Math.floor((Date.now() - new Date(row.lastSyncAt)) / 60_000) : null;

  return {
    ...row,
    punchCount: _count?.punches ?? 0,
    silentMinutes,
    // Derived rather than trusted: a box that has fallen off the network cannot
    // tell us it has.
    isHealthy: row.isActive && silentMinutes != null && silentMinutes <= staleAfterMinutes,
    hasEverSynced: Boolean(row.lastSyncAt),
  };
}

export async function registerDevice(data, actor = null) {
  const branch = await prisma.branch.findUnique({ where: { id: data.branchId }, select: { id: true, timezone: true } });
  if (!branch) throw ApiError.validation("Branch not found", { branchId: ["No such branch"] });

  const existing = await prisma.attendanceDevice.findUnique({
    where: { serialNumber: data.serialNumber },
    select: { id: true, name: true },
  });
  if (existing) {
    throw ApiError.conflict(`Serial ${data.serialNumber} is already registered as ${existing.name}`);
  }

  // Shown once, here, and never again.
  const apiKey = `dev_${shortCode(32)}`;

  const device = await prisma.attendanceDevice.create({
    data: {
      branchId: data.branchId,
      name: data.name,
      serialNumber: data.serialNumber,
      vendor: data.vendor ?? null,
      model: data.model ?? null,
      ipAddress: data.ipAddress ?? null,
      timezone: data.timezone ?? branch.timezone ?? "UTC",
      apiKeyHash: hashToken(apiKey),
      status: "OFFLINE",
      isActive: true,
    },
    select: SELECT,
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: data.branchId,
    action: "attendance_device.register",
    entityType: "AttendanceDevice",
    entityId: device.id,
    changes: { name: device.name, serialNumber: device.serialNumber },
  });

  return { ...shape(device), apiKey };
}

/**
 * Authenticates a device from its key.
 *
 * Looked up by serial and then compared by hash, so a key alone is not enough —
 * the caller has to know which device it is claiming to be.
 */
export async function authenticateDevice({ serialNumber, apiKey }) {
  if (!serialNumber || !apiKey) throw ApiError.unauthorized("Device credentials required");

  const device = await prisma.attendanceDevice.findUnique({
    where: { serialNumber },
    select: { id: true, branchId: true, apiKeyHash: true, isActive: true, name: true, timezone: true, lastLogCursor: true },
  });

  // Compared in constant time, and with the same message either way: a caller
  // probing serials should learn neither which ones exist nor how much of a key
  // it got right.
  if (!device || !device.apiKeyHash || !verifyToken(apiKey, device.apiKeyHash)) {
    throw ApiError.unauthorized("Device credentials are not valid");
  }
  if (!device.isActive) throw ApiError.forbidden("This device has been deactivated");

  return device;
}

export async function rotateDeviceKey(id, actor) {
  const device = await prisma.attendanceDevice.findUnique({ where: { id }, select: { id: true, name: true, branchId: true } });
  if (!device) throw ApiError.notFound("Device not found");

  const apiKey = `dev_${shortCode(32)}`;
  await prisma.attendanceDevice.update({ where: { id }, data: { apiKeyHash: hashToken(apiKey) } });

  await recordAudit({
    actorId: actor.userId,
    branchId: device.branchId,
    action: "attendance_device.rotate_key",
    entityType: "AttendanceDevice",
    entityId: id,
    changes: { name: device.name },
  });

  return { id, apiKey, rotated: true };
}

export async function updateDevice(id, data, actor = null) {
  const device = await prisma.attendanceDevice.findUnique({ where: { id }, select: { id: true, branchId: true } });
  if (!device) throw ApiError.notFound("Device not found");

  const updated = await prisma.attendanceDevice.update({
    where: { id },
    data: {
      ...(data.name != null ? { name: data.name } : {}),
      ...(data.vendor !== undefined ? { vendor: data.vendor } : {}),
      ...(data.model !== undefined ? { model: data.model } : {}),
      ...(data.ipAddress !== undefined ? { ipAddress: data.ipAddress } : {}),
      ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
      ...(data.isActive != null ? { isActive: data.isActive, ...(data.isActive ? {} : { status: "DECOMMISSIONED" }) } : {}),
    },
    select: SELECT,
  });

  return shape(updated);
}

/** Records that a device checked in, and how far it got. */
export async function recordSync({ deviceId, cursor = null, status = "ONLINE", punchCount = 0 }) {
  const device = await prisma.attendanceDevice.update({
    where: { id: deviceId },
    data: {
      lastSyncAt: new Date(),
      status,
      ...(cursor ? { lastLogCursor: String(cursor) } : {}),
    },
    select: SELECT,
  });

  logger.info("attendance device synced", { deviceId, cursor, punchCount });
  return shape(device);
}

export async function listDevices({ branchId, isActive, scope = null } = {}) {
  const filter = branchFilter(scope);
  const rows = await prisma.attendanceDevice.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(filter ? { AND: [{ branchId: filter }] } : {}),
      ...(isActive != null ? { isActive } : {}),
    },
    select: SELECT,
    orderBy: { name: "asc" },
  });

  return rows.map((row) => shape(row));
}

export async function getDevice(id) {
  const device = await prisma.attendanceDevice.findUnique({ where: { id }, select: SELECT });
  if (!device) throw ApiError.notFound("Device not found");
  return shape(device);
}

/**
 * The health board.
 *
 * The question worth asking of a fleet of terminals is not "are they all fine"
 * but "which one stopped" — a device that went quiet three days ago has been
 * losing punches for three days, and nobody finds out until payroll.
 */
export async function deviceHealth({ branchId = null, staleAfterMinutes = STALE_AFTER_MINUTES, scope = null } = {}) {
  const filter = branchFilter(scope);
  const devices = await prisma.attendanceDevice.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(filter ? { AND: [{ branchId: filter }] } : {}),
      isActive: true,
    },
    select: SELECT,
  });

  const shaped = devices.map((device) => shape(device, { staleAfterMinutes }));

  return {
    total: shaped.length,
    healthy: shaped.filter((device) => device.isHealthy).length,
    stale: shaped.filter((device) => !device.isHealthy && device.hasEverSynced).length,
    neverSynced: shaped.filter((device) => !device.hasEverSynced).length,
    // Quietest first: the one that stopped longest ago is the one losing most.
    devices: shaped.sort((a, b) => (b.silentMinutes ?? Infinity) - (a.silentMinutes ?? Infinity)),
  };
}

/** Marks devices that have gone quiet, so a dashboard reads the truth. */
export async function flagStaleDevices({ staleAfterMinutes = STALE_AFTER_MINUTES } = {}) {
  const cutoff = new Date(Date.now() - staleAfterMinutes * 60_000);

  const result = await prisma.attendanceDevice.updateMany({
    where: { isActive: true, status: "ONLINE", lastSyncAt: { lt: cutoff } },
    data: { status: "OFFLINE" },
  });

  return { flagged: result.count, staleAfterMinutes };
}
