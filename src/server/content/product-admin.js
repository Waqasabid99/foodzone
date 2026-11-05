import { prisma } from "@/lib/prisma";
import { listCategories } from "@/server/services/category.service";
import { listStations } from "@/server/services/station.service";
import { listTaxGroups } from "@/server/services/tax.service";
import { flattenTree, toTree } from "@/lib/category-tree";
import { holdsCompanyWide } from "@/lib/api/permissions";
import { actionableBranches } from "@/server/content/creator-admin";

/**
 * The choices a product form offers: categories (indented, in menu order),
 * kitchen stations and tax groups.
 *
 * Inactive stations and tax groups are left out of the choices but a product
 * already pointing at one keeps it listed, marked — otherwise opening the form
 * would silently show "none" and saving would clear it.
 */
export async function productFormOptions({ current = null, principal = null } = {}) {
  const [categories, stations, taxGroups, branches, menus] = await Promise.all([
    listCategories(),
    listStations(),
    listTaxGroups(),
    principal ? actionableBranches(principal, "products.create") : [],
    principal ? menuChoices(principal) : [],
  ]);

  const keep = (rows, id) => rows.filter((row) => row.isActive || row.id === id);

  return {
    /**
     * Empty for a single-restaurant installation, which is the signal to the
     * form that there is no branch question worth asking. With one outlet
     * there is only one answer, and showing the field would be noise on every
     * product anyone ever creates.
     */
    branches: branches.length > 1 ? branches.map((row) => ({ value: row.id, label: row.name })) : [],
    /**
     * The menus this person may put the new product on.
     *
     * Empty on the edit form, which passes no principal — placement there is
     * still the Menus page's job, where a price override and a section can be
     * set at the same time. On create the question is simply "where does this
     * sell", and making somebody leave the page to answer it is how a product
     * ends up saved and sold nowhere.
     */
    menus,
    canWriteChainWide:
      principal?.isSuperAdmin || (principal ? holdsCompanyWide(principal, "products.create") : false),
    categories: flattenTree(toTree(categories)).map((row) => ({
      value: row.id,
      label: `${"— ".repeat(row.depth - 1)}${row.name}${row.isActive ? "" : " (hidden)"}`,
    })),
    stations: keep(stations, current?.stationId).map((row) => ({
      value: row.id,
      label: `${row.name}${row.isActive ? "" : " (switched off)"}`,
    })),
    taxGroups: keep(taxGroups, current?.taxGroupId).map((row) => ({
      value: row.id,
      label: `${row.name} — ${row.effectiveRate}%${row.isInclusive ? " included" : " added"}${row.isActive ? "" : " (switched off)"}`,
    })),
  };
}

/**
 * Menus somebody may add an item to, newest branch order, with the branch named.
 *
 * Scoped by `menus.update` rather than by `products.create`: being allowed to
 * write a product says nothing about being allowed to change what a branch
 * sells, and those are different jobs in a chain. Switched-off menus are listed
 * and marked — a product can legitimately be staged on one before it is turned
 * on, and silently hiding them would look like the menu had vanished.
 */
export async function menuChoices(principal) {
  const branches = await actionableBranches(principal, "menus.update");
  if (!branches.length) return [];

  const rows = await prisma.menu.findMany({
    where: { branchId: { in: branches.map((branch) => branch.id) } },
    select: { id: true, name: true, type: true, isActive: true, branchId: true, branch: { select: { name: true } } },
    orderBy: [{ branchId: "asc" }, { type: "asc" }, { name: "asc" }],
  });

  return rows.map((row) => ({
    value: row.id,
    branchId: row.branchId,
    branchName: row.branch.name,
    label: `${row.name}${row.isActive ? "" : " (switched off)"}`,
    type: row.type,
  }));
}

/**
 * Everything a combo slot could offer: every product that is not itself a combo
 * and not deleted, with its sizes.
 *
 * Unpublished products are included and marked. A combo is often built before
 * its parts go live, and hiding drafts would make that impossible — the combo's
 * health check says plainly when a chosen part is not on sale.
 */
export async function comboChoiceCatalog() {
  const rows = await prisma.product.findMany({
    where: { deletedAt: null, type: { not: "COMBO" } },
    select: {
      id: true,
      name: true,
      isActive: true,
      category: { select: { name: true } },
      variants: {
        select: { id: true, name: true, price: true, isActive: true, isDefault: true },
        orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
      },
    },
    orderBy: [{ name: "asc" }],
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    category: row.category?.name ?? null,
    variants: row.variants.map((variant) => ({ ...variant, price: Number(variant.price) })),
  }));
}
