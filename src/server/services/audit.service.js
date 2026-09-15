import { prisma } from "@/lib/prisma";
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
  limit = 20,
  cursor,
}) {
  const where = {
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
export async function listAuditActions() {
  const rows = await prisma.auditLog.findMany({
    distinct: ["action"],
    select: { action: true },
    orderBy: { action: "asc" },
    take: 500,
  });
  return rows.map((row) => row.action);
}
