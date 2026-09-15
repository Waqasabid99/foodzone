import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Writes to the audit trail.
 *
 * Auditing must never break the request that triggered it: a failed insert is
 * logged and swallowed. Call it inside `after()` (the handler pipeline does)
 * so the write happens once the response is already on its way.
 */
export async function recordAudit({
  actorId = null,
  branchId = null,
  action,
  entityType,
  entityId = null,
  changes = null,
  ipAddress = null,
  userAgent = null,
}) {
  try {
    await prisma.auditLog.create({
      data: { actorId, branchId, action, entityType, entityId, changes, ipAddress, userAgent },
    });
  } catch (error) {
    logger.error("audit write failed", { action, entityType, entityId, error: error.message });
  }
}

/**
 * Reduces two records to the fields that actually changed, as
 * `{ field: { before, after } }`. Storing whole rows makes the trail unreadable
 * and duplicates data that is already in the table.
 */
export function diff(before, after, { ignore = ["updatedAt"] } = {}) {
  const changes = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);

  for (const key of keys) {
    if (ignore.includes(key)) continue;
    const from = normalise(before?.[key]);
    const to = normalise(after?.[key]);
    if (from !== to) changes[key] = { before: from, after: to };
  }

  return Object.keys(changes).length ? changes : null;
}

function normalise(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}
