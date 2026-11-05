import { prisma } from "@/lib/prisma";
import { branchScope } from "@/lib/api/permissions";

/**
 * The branches a permission is actually held at.
 *
 * Every workspace list that offers "which branch?" needs the same answer, and
 * it is not "all of them": a manager scoped to one outlet must be offered that
 * outlet only, or the filter becomes a way to read another branch's data.
 */
export async function scopedBranches(principal, permissionKey) {
  const scope = branchScope(principal, permissionKey);
  const where = scope.all ? (scope.except.length ? { id: { notIn: scope.except } } : {}) : { id: { in: scope.ids } };

  return prisma.branch.findMany({
    where,
    select: { id: true, name: true, code: true, timezone: true, isActive: true, currency: true },
    orderBy: { name: "asc" },
    take: 1000,
  });
}
