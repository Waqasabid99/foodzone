import { prisma } from "@/lib/prisma";
import { branchScope, can } from "@/lib/api/permissions";
import { branchFilter } from "@/server/access/scope";
import { scopedBranches } from "@/server/content/branch-scope";

/**
 * What the Insights screens need besides the figures: the filter options, and
 * the handful of counts that tell a reader how much is behind a number.
 *
 * Everything is cut to the viewer's branches, including the *option lists*.
 * A filter dropdown is data: offering "Lahore" to a manager who can only see
 * Karachi tells them Lahore exists, who works there, and what they have been
 * doing — before a single row is fetched.
 */

export { scopedBranches };

export async function actionableBranches(principal, permissionKey) {
  const branches = await scopedBranches(principal, permissionKey);
  return branches.filter((branch) => branch.isActive && can(principal, permissionKey, { branchId: branch.id }));
}

/** The branch filter for an audit reader, plus the company-level bucket. */
function auditWhere(principal) {
  const filter = branchFilter(branchScope(principal, "audit_logs.read"));
  return filter ? { OR: [{ branchId: filter }, { branchId: null }] } : {};
}

/**
 * The people who appear in the log this reader can see.
 *
 * Drawn from the log rather than from the user table: offering every account
 * in the company as a filter would be a staff directory handed to anyone who
 * can read one branch's audit trail, and most of those names have never done
 * anything the reader may look at.
 */
export async function auditActors(principal) {
  const rows = await prisma.auditLog.findMany({
    where: { ...auditWhere(principal), actorId: { not: null } },
    distinct: ["actorId"],
    select: { actorId: true },
    take: 300,
  });

  const ids = rows.map((row) => row.actorId).filter(Boolean);
  if (!ids.length) return [];

  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  return users.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
}

/** The kinds of record that appear in the log this reader can see. */
export async function auditEntityTypes(principal) {
  const rows = await prisma.auditLog.findMany({
    // `entityType` is a required column, so there is nothing to exclude.
    where: auditWhere(principal),
    distinct: ["entityType"],
    select: { entityType: true },
    orderBy: { entityType: "asc" },
    take: 300,
  });
  return rows.map((row) => row.entityType).filter(Boolean);
}

/**
 * How much of the log there is, and how far back it goes.
 *
 * The oldest entry matters more than the count. An audit trail that starts
 * three weeks ago cannot answer a question about last quarter, and a reader
 * who does not know that will conclude nothing happened.
 */
export async function auditDepth(principal) {
  const where = auditWhere(principal);
  const [total, oldest, newest] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findFirst({ where, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.auditLog.findFirst({ where, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);

  return { total, oldest: oldest?.createdAt ?? null, newest: newest?.createdAt ?? null };
}

/**
 * Whether there is anything at all behind a report, before it is drawn.
 *
 * An empty chart and a chart of zeroes look identical and mean opposite
 * things: "no orders in this range" versus "no orders have ever been
 * recorded". The reports say which.
 */
export async function hasAnyOrders(principal) {
  const filter = branchFilter(branchScope(principal, "reports.view_sales"));
  const count = await prisma.order.count({
    where: { status: "COMPLETED", ...(filter ? { AND: [{ branchId: filter }] } : {}) },
    take: 1,
  });
  return count > 0;
}

/** Branch names for ids a scoped report may contain. */
export async function branchNames(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const rows = await prisma.branch.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return Object.fromEntries(rows.map((row) => [row.id, row.name]));
}
