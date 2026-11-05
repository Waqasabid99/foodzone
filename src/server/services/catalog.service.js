import { prisma } from "@/lib/prisma";
import { ApiError, cursorArgs, toPage } from "@/lib/api";
import { shapeProduct } from "@/server/services/product.service";
import { buildTree } from "@/server/services/category.service";

/**
 * The public catalog: what an anonymous visitor may read.
 *
 * Deliberately a separate module from `product.service.js` even though the
 * tables are the same. The admin service answers "what exists"; this one
 * answers "what may a customer see", and the two have different filters
 * (`isActive`, `deletedAt`) and different shapes. Keeping them apart is what
 * stops an unpublished product leaking through a forgotten `where` clause.
 *
 * Branch-specific pricing and availability live on menus, not here — see
 * `getBranchMenu`. These endpoints are the catalog-wide browse and search.
 */

const PUBLIC_VARIANT_SELECT = {
  id: true,
  name: true,
  price: true,
  compareAtPrice: true,
  servingSize: true,
  isDefault: true,
  sortOrder: true,
};

const PUBLIC_LIST_SELECT = {
  id: true,
  name: true,
  slug: true,
  shortDescription: true,
  type: true,
  imageUrl: true,
  dietary: true,
  spiceLevel: true,
  prepTimeMinutes: true,
  isFeatured: true,
  sortOrder: true,
  category: { select: { id: true, name: true, slug: true } },
  variants: {
    where: { isActive: true },
    select: PUBLIC_VARIANT_SELECT,
    orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
  },
};

/** Published, not deleted, and with something sellable on it. */
const VISIBLE = {
  isActive: true,
  deletedAt: null,
  category: { isActive: true },
  variants: { some: { isActive: true } },
};

export async function publicCategories({ tree = false } = {}) {
  const rows = await prisma.category.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      imageUrl: true,
      parentId: true,
      sortOrder: true,
      _count: { select: { products: { where: VISIBLE } } },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  const items = rows.map(({ _count, ...row }) => ({ ...row, productCount: _count.products }));
  return tree ? buildTree(items) : items;
}

/**
 * Which products a shopper is shown.
 *
 * A product with no branch is the chain's; one pinned to an outlet belongs
 * only there. Three cases, and the third exists to avoid a trap:
 *
 *   * a branch chosen — that outlet's items plus the chain's;
 *   * several branches and none chosen — the chain's only, because an item
 *     one outlet sells cannot be bought until you say which outlet;
 *   * a single-restaurant installation — everything, whether or not the
 *     operator happened to pin products to their one branch. Without this
 *     last case a single-branch shop that set a branch on its products would
 *     show an empty menu to every visitor.
 */
async function visibleBranchWhere(branchId) {
  if (branchId) return { OR: [{ branchId: null }, { branchId }] };
  const branches = await prisma.branch.count({ where: { isActive: true } });
  return branches <= 1 ? {} : { branchId: null };
}

export async function publicProducts({ category, search, dietary, featured, branchId, limit = 20, cursor } = {}) {
  const rows = await prisma.product.findMany({
    where: {
      ...VISIBLE,
      ...(await visibleBranchWhere(branchId)),
      ...(category ? { category: { isActive: true, OR: [{ slug: category }, { id: category }] } } : {}),
      ...(featured !== undefined ? { isFeatured: featured } : {}),
      ...(dietary ? { dietary: { has: dietary } } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { shortDescription: { contains: search, mode: "insensitive" } },
              { description: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: PUBLIC_LIST_SELECT,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);
  return { ...page, items: page.items.map(shapeProduct) };
}

/**
 * A product page: everything needed to build the order form — variants,
 * modifier groups with their effective rules, and combo slots.
 */
export async function publicProduct(slug) {
  const product = await prisma.product.findFirst({
    where: { ...VISIBLE, OR: [{ slug }, { id: slug }] },
    select: {
      ...PUBLIC_LIST_SELECT,
      description: true,
      allergens: true,
      calories: true,
      images: { select: { id: true, url: true, altText: true }, orderBy: { sortOrder: "asc" } },
      modifierGroups: {
        orderBy: { sortOrder: "asc" },
        select: {
          isRequired: true,
          minSelect: true,
          maxSelect: true,
          sortOrder: true,
          group: {
            select: {
              id: true,
              name: true,
              selectionType: true,
              minSelect: true,
              maxSelect: true,
              allowQuantity: true,
              isActive: true,
              options: {
                where: { isActive: true },
                select: { id: true, name: true, priceDelta: true, isDefault: true, sortOrder: true },
                orderBy: { sortOrder: "asc" },
              },
            },
          },
        },
      },
      comboGroups: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          minSelect: true,
          maxSelect: true,
          options: {
            orderBy: { sortOrder: "asc" },
            // An option whose product was unpublished must not be offerable.
            where: { product: { isActive: true, deletedAt: null } },
            select: {
              id: true,
              quantity: true,
              priceDelta: true,
              isDefault: true,
              /*
               * The chosen item's own options come with it, so a meal deal can
               * ask for the burger without onions. Same shape as the product's
               * own groups above, because the same form renders both and the
               * cart resolves both with one function.
               */
              product: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  imageUrl: true,
                  modifierGroups: {
                    orderBy: { sortOrder: "asc" },
                    select: {
                      isRequired: true,
                      minSelect: true,
                      maxSelect: true,
                      group: {
                        select: {
                          id: true,
                          name: true,
                          selectionType: true,
                          minSelect: true,
                          maxSelect: true,
                          allowQuantity: true,
                          isActive: true,
                          options: {
                            where: { isActive: true },
                            select: { id: true, name: true, priceDelta: true, isDefault: true, sortOrder: true },
                            orderBy: { sortOrder: "asc" },
                          },
                        },
                      },
                    },
                  },
                },
              },
              variant: { select: { id: true, name: true, price: true } },
            },
          },
        },
      },
    },
  });
  if (!product) throw ApiError.notFound("Product not found");

  return shapeProduct(product);
}

/**
 * Search across the catalog for the app's search bar.
 *
 * Returns products and the categories whose names match, so one round trip
 * populates the whole results screen.
 */
export async function searchCatalog({ search, limit = 20 }) {
  const [products, categories] = await Promise.all([
    publicProducts({ search, limit }),
    prisma.category.findMany({
      where: { isActive: true, name: { contains: search, mode: "insensitive" } },
      select: { id: true, name: true, slug: true, imageUrl: true },
      take: 10,
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  return { query: search, products: products.items, nextCursor: products.nextCursor, categories };
}
