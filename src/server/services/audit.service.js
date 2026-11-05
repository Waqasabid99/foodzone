import { prisma } from "@/lib/prisma";
import { branchFilter } from "@/server/access/scope";
import { cursorArgs, toPage } from "@/lib/api";

/**
 * Reads the audit trail.
 *
 * Writes happen through `apiHandler`'s `audit` option and the services, never
 * here — this is query-only by design, and the table has no update or delete
 * path anywhere in the codebase.
 */
export async function listAuditLogs({
  actorId,
  action,
  entityType,
  entityId,
  branchId,
  from,
  to,
  search,
  scope = null,
  limit = 20,
  cursor,
}) {
  // An audit entry names a person and what they did to which record at which
  // outlet. Unfiltered, it is a log of every branch's activity handed to
  // whoever can read one branch's.
  //
  // Company-level entries carry no branch — a role edited, a global setting
  // changed — and stay visible, matching how the journal and every other
  // company-wide record is treated: holding the permission anywhere is
  // enough for something that belongs to no outlet.
  const filter = branchFilter(scope);

  const where = {
    ...(filter ? { AND: [{ OR: [{ branchId: filter }, { branchId: null }] }] } : {}),
    ...(actorId ? { actorId } : {}),
    // Prefix match, so "order." returns every order action.
    ...(action ? { action: { startsWith: action } } : {}),
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
    ...(branchId ? { branchId } : {}),
    ...(from || to
      ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
      : {}),
    ...(search
      ? {
          OR: [
            { action: { contains: search, mode: "insensitive" } },
            { entityType: { contains: search, mode: "insensitive" } },
            { entityId: { contains: search } },
          ],
        }
      : {}),
  };

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      actor: { select: { id: true, name: true, email: true } },
      branch: { select: { id: true, name: true, code: true } },
    },
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

/** The distinct action names present, for populating a filter dropdown. */
export async function listAuditActions({ scope = null } = {}) {
  // Scoped for the same reason the list is: the set of actions present is
  // itself a readout of what the other branches have been doing.
  const filter = branchFilter(scope);

  const rows = await prisma.auditLog.findMany({
    where: filter ? { OR: [{ branchId: filter }, { branchId: null }] } : {},
    distinct: ["action"],
    select: { action: true },
    orderBy: { action: "asc" },
    take: 500,
  });
  return rows.map((row) => row.action);
}
