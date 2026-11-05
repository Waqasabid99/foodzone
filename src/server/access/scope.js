import { ApiError, assertBranchAccess } from "@/lib/api";
import { branchScope, can } from "@/lib/api/permissions";

/**
 * Turning a permission scope into a database filter.
 *
 * `can()` answers "may this person do X at branch B?" — the right question for
 * one record. A list needs the other half: *which* branches may they see at
 * all? Without it a manager scoped to one outlet asks for "everything", passes
 * the permission check (they do hold the key, somewhere) and is handed the
 * whole company.
 *
 * These helpers started in the inventory module and are shared verbatim by HR,
 * which has the same shape of problem with a different set of tables. They live
 * here so neither module has to import the other's internals.
 */

/** A Prisma filter for a `branchId` column, from `branchScope()`. Null when unrestricted. */
export function branchFilter(scope) {
  if (!scope) return null;
  if (scope.all) return scope.except?.length ? { notIn: scope.except } : null;
  return { in: scope.ids };
}

/**
 * Wraps `branchFilter` at whatever path the model keeps its branch.
 *
 *   scopeWhere(scope, (branchId) => ({ location: { branchId } }))
 */
export function scopeWhere(scope, at = (branchId) => ({ branchId })) {
  const filter = branchFilter(scope);
  return filter ? at(filter) : {};
}

/**
 * The same cut, for a model that keeps a *list* of branches rather than one.
 *
 * `Promotion.branchIds` and `CreatorCommissionRule.branchIds` are both string
 * arrays, where an empty array means "the whole chain". Two things make this
 * harder than `scopeWhere`, and both have a wrong answer that silently matches
 * everything:
 *
 *   * An empty list is not "no branches", it is *every* branch, so it must
 *     always match.
 *   * `branchScope` can say "everywhere except these", and Postgres array
 *     operators cannot express "contains at least one element outside that
 *     set". `hasEvery` asks the opposite question and reads almost the same.
 *     So a carve-out is resolved into the branches it leaves behind and
 *     matched positively — one cheap indexed read in the rare case, none in
 *     the common ones.
 *
 * Lives here rather than in either caller because the two modules would
 * otherwise each carry a copy of that reasoning, and the copies would drift.
 */
export async function branchListWhere(scope, prisma) {
  const filter = branchFilter(scope);
  if (!filter) return {};

  const reachable = Array.isArray(filter.in)
    ? filter.in
    : (
        await prisma.branch.findMany({
          where: { id: { notIn: filter.notIn ?? [] } },
          select: { id: true },
        })
      ).map((row) => row.id);

  return { OR: [{ branchIds: { hasSome: reachable } }, { branchIds: { isEmpty: true } }] };
}

/**
 * Whether a caller may *reach* a list of branches for reading.
 *
 * An empty list is chain-wide and so readable by anyone holding the
 * permission anywhere: what the company is doing is not a secret from its own
 * managers. Writing one is a different question — see `assertListReach`.
 */
export function reachesBranchList(principal, branchIds, permissionKey) {
  if (principal?.isSuperAdmin) return true;
  const scope = branchScope(principal, permissionKey);
  if (scope.all) return !branchIds?.length || branchIds.some((id) => !scope.except?.includes(id));
  if (!branchIds?.length) return true;
  return branchIds.some((id) => scope.ids.includes(id));
}

/** The branches both scopes cover. */
export function intersectScopes(a, b) {
  if (!a || !b) return a ?? b ?? null;
  if (a.all && b.all) return { all: true, except: [...new Set([...(a.except ?? []), ...(b.except ?? [])])] };
  if (a.all) return { all: false, ids: b.ids.filter((id) => !a.except?.includes(id)) };
  if (b.all) return { all: false, ids: a.ids.filter((id) => !b.except?.includes(id)) };
  return { all: false, ids: a.ids.filter((id) => b.ids.includes(id)) };
}

/** True when a branch id is inside a scope. */
export function inScope(scope, branchId) {
  if (!scope) return true;
  if (scope.all) return !scope.except?.includes(branchId);
  return scope.ids.includes(branchId);
}

/** Holds any role at the branch, or a company-wide one. */
export function reaches(principal, branchId) {
  if (!principal) return false;
  if (principal.isSuperAdmin) return true;
  return principal.branchIds.includes(null) || principal.branchIds.includes(branchId);
}

/**
 * Builds `recordBranches` / `assertRecordAccess` for one module's tables.
 *
 * `lookups` maps a kind to a function returning the branch ids a record
 * touches; `notFound` maps the same kind to the sentence a caller sees when it
 * is missing — or when it belongs to a branch they cannot work at.
 *
 * **404, not 403, when the permission is not held at that branch.** "That
 * employee exists at another outlet" is itself something a scoped supervisor
 * has no business learning, and a 403 confirms the id is real. The test is the
 * caller's scope *for this permission*, not whether they hold any role there:
 * every signed-in person carries a company-wide role for their own account, so
 * "do they have a role at that branch" is true for everybody and would hand
 * back 403 — and with it, confirmation — every time.
 *
 * A 403 is still what comes back when they do hold the permission across the
 * company and it has been carved out for this one branch. There the record's
 * existence is not the secret; the refusal is explainable, and a screen can
 * say so.
 */
export function recordAccess(lookups, notFound) {
  async function recordBranches(kind, id) {
    const branches = await lookups[kind](id);
    if (!branches || !branches.length) throw ApiError.notFound(notFound[kind]);
    return branches;
  }

  async function assertRecordAccess(principal, kind, id, permissionKey) {
    const [branchId] = await recordBranches(kind, id);

    // A company-wide record — a holiday on every site, a payroll run across
    // every branch, a cart whose shopper has not picked an outlet yet — has no
    // branch to place it at, so the permission alone decides and holding it
    // anywhere is enough.
    //
    // Deliberately not `assertBranchAccess(principal, null, ...)`: that helper
    // refuses a null branch outright with "a branch must be specified", which
    // turned every company-wide record into a 400 for everybody, super admins
    // included. The absence of a branch is the answer here, not a missing
    // argument.
    if (branchId == null) {
      if (permissionKey && !principal?.isSuperAdmin && !can(principal, permissionKey)) {
        throw ApiError.forbidden("You do not have permission to do that", { required: [permissionKey] });
      }
      return null;
    }

    if (permissionKey && !inScope(branchScope(principal, permissionKey), branchId)) {
      throw ApiError.notFound(notFound[kind]);
    }

    assertBranchAccess(principal, branchId, permissionKey);
    return branchId;
  }

  return { recordBranches, assertRecordAccess };
}
