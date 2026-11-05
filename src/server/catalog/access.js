import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { assertCompanyWide, branchScope, holdsCompanyWide } from "@/lib/api/permissions";
import { branchFilter } from "@/server/access/scope";

/**
 * Who may see and change a product.
 *
 * `Product.branchId` is nullable and that is the whole design:
 *
 *   * **Null is the chain's catalogue.** The item is on sale at every outlet,
 *     now and at any opened later. It is the default, so a restaurant with
 *     one branch never sets it, never sees a branch field, and behaves
 *     exactly as it did before this column existed.
 *   * **Set, and the product belongs to that outlet.** A manager elsewhere
 *     cannot see it, price it, report on it, or moderate a video filmed of
 *     it. This is what makes "my branch's menu" a real boundary rather than
 *     a filter somebody could drop.
 *
 * Reading follows the promotions rule — a chain-wide item is visible to
 * anyone who may read products, because what the company sells is not a
 * secret from its own managers. **Writing one does not.** Creating or editing
 * a chain-wide product changes what every outlet sells, so it takes a
 * company-wide grant, the same test a chain-wide promotion or a tax rate
 * gets. Without that, a manager at one branch could add an item, or change a
 * price, across the whole company.
 */

/** Products the caller may see. Empty clause when unrestricted. */
export function productScopeWhere(scope) {
  const filter = branchFilter(scope);
  if (!filter) return {};
  // Chain-wide items always match; branch-owned ones only within scope.
  return { OR: [{ branchId: filter }, { branchId: null }] };
}

/** The same cut, reached through a relation — a video, an order line, a review. */
export function viaProduct(scope) {
  const where = productScopeWhere(scope);
  return Object.keys(where).length ? { product: where } : {};
}

/** Whether the caller may reach a product owned by this branch. */
export function reachesProduct(principal, branchId, permissionKey) {
  if (principal?.isSuperAdmin) return true;
  // Chain-wide is reachable by anyone holding the permission anywhere, so
  // this is settled before asking what their scope is.
  if (!branchId) return true;
  const scope = branchScope(principal, permissionKey);
  if (scope.all) return !scope.except?.includes(branchId);
  return scope.ids.includes(branchId);
}

/**
 * Reading one product.
 *
 * 404 rather than 403 for another branch's item, as everywhere else: a 403
 * confirms the id is real, and which products a neighbouring outlet sells is
 * not something a scoped manager should be able to probe for.
 */
export async function assertProductAccess(principal, productId, permissionKey) {
  const product = await prisma.product.findFirst({
    where: { OR: [{ id: productId }, { slug: productId }] },
    select: { id: true, branchId: true },
  });
  if (!product) throw ApiError.notFound("Product not found");
  if (!reachesProduct(principal, product.branchId, permissionKey)) {
    throw ApiError.notFound("Product not found");
  }
  return product;
}

/**
 * Who may write a product owned by this branch.
 *
 * Null means every outlet including ones opened later, so it takes a
 * company-wide grant. A named branch has to be one the caller covers.
 */
export function assertProductReach(principal, branchId, permissionKey) {
  if (principal?.isSuperAdmin) return;

  if (!branchId) {
    assertCompanyWide(principal, permissionKey);
    return;
  }

  if (holdsCompanyWide(principal, permissionKey)) return;

  const scope = branchScope(principal, permissionKey);
  if (!scope.all && !scope.ids.includes(branchId)) {
    throw ApiError.forbidden("That product would belong to a branch you do not cover", {
      required: [permissionKey],
      branchIds: [branchId],
    });
  }
  if (scope.all && scope.except?.includes(branchId)) {
    throw ApiError.forbidden("That product would belong to a branch you do not cover", {
      required: [permissionKey],
      branchIds: [branchId],
    });
  }
}

/**
 * The branch a new record should default to, when the operator has only one.
 *
 * A single-branch restaurant must never be asked which outlet something is
 * for — there is only one answer and the question is noise. Returns null when
 * there are several, which is the signal to show a picker.
 */
export async function soleBranchId() {
  const branches = await prisma.branch.findMany({ where: { isActive: true }, select: { id: true }, take: 2 });
  return branches.length === 1 ? branches[0].id : null;
}

/** True when this installation is a single restaurant rather than a chain. */
export async function isSingleBranch() {
  const count = await prisma.branch.count({ where: { isActive: true } });
  return count <= 1;
}
