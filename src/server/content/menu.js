import { unstable_cache } from "next/cache";
import { CacheTag } from "@/lib/cache-tags";
import { getOrderMenu } from "@/server/services/menu.service";
import { publicCategories, publicProducts } from "@/server/services/catalog.service";
import { getSettings } from "@/server/services/setting.service";
import { logger } from "@/lib/logger";

/**
 * Everything the menu page renders, from whichever source can answer.
 *
 * Two sources, deliberately, because they answer different questions:
 *
 *   * `getBranchMenu` is the real thing — the menu that outlet is serving right
 *     now, with its own prices, its own sections, its 86'd items removed and
 *     its time windows respected. It is what a customer will actually be
 *     charged, so with a branch chosen it always wins.
 *
 *   * The global catalog is the fallback for when there is no branch to ask:
 *     nobody has picked an outlet yet, or none is configured. It keeps the page
 *     from being blank, and it is honest about what it is — `source` says which
 *     one you got, and the page tells the visitor when prices are indicative.
 *
 * Both are flattened into one shape so no component has to know the difference.
 */

/**
 * One minute.
 *
 * Short on purpose. A branch menu carries availability that staff toggle from
 * the kitchen — marking an item off mid-service is the whole point of the
 * feature — and menus switch on a schedule. Caching that for long enough to be
 * worth much is caching the wrong thing; a minute absorbs a rush without
 * letting a sold-out item stay orderable.
 */
const BRANCH_MENU_REVALIDATE = 60;

/** The catalog fallback changes only when someone edits the catalog. */
const CATALOG_REVALIDATE = 300;

/** Flattens a branch menu product into the card shape the page renders. */
function fromMenuProduct(product) {
  const variants = product.variants.map((variant) => ({
    variantId: variant.variantId,
    name: variant.name,
    price: variant.price,
    compareAtPrice: variant.compareAtPrice,
    available: variant.available,
  }));

  return {
    id: product.productId,
    name: product.name,
    slug: product.slug,
    shortDescription: null,
    imageUrl: product.imageUrl,
    dietary: product.dietary ?? [],
    spiceLevel: product.spiceLevel ?? null,
    prepTimeMinutes: product.prepTimeMinutes ?? null,
    categoryName: product.category?.name ?? null,
    isRecommended: Boolean(product.isRecommended),
    isCombo: product.type === "COMBO",
    priceFrom: product.priceFrom,
    compareAtPrice: variants.find((variant) => variant.compareAtPrice)?.compareAtPrice ?? null,
    available: variants.some((variant) => variant.available),
    variants,
  };
}

/** The same shape, built from a catalog row. */
function fromCatalogProduct(product) {
  const variants = (product.variants ?? []).map((variant) => ({
    variantId: variant.id,
    name: variant.name,
    price: Number(variant.price),
    compareAtPrice: variant.compareAtPrice != null ? Number(variant.compareAtPrice) : null,
    // The catalog has no per-branch availability to report, so nothing here
    // claims to know it. The page says so rather than implying otherwise.
    available: true,
  }));

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    shortDescription: product.shortDescription ?? null,
    imageUrl: product.imageUrl,
    dietary: product.dietary ?? [],
    spiceLevel: product.spiceLevel ?? null,
    prepTimeMinutes: product.prepTimeMinutes ?? null,
    categoryName: product.category?.name ?? null,
    isRecommended: Boolean(product.isFeatured),
    isCombo: product.type === "COMBO",
    priceFrom: product.priceFrom ?? (variants.length ? Math.min(...variants.map((v) => v.price)) : null),
    compareAtPrice: variants.find((variant) => variant.compareAtPrice)?.compareAtPrice ?? null,
    available: true,
    variants,
  };
}

async function loadBranchMenu(branchId, orderType) {
  // By order type, exactly as the cart resolves it, so the price on the card
  // is the price at checkout.
  const result = await getOrderMenu({ branchIdOrCode: branchId, orderType });

  return {
    reason: result.reason,
    menuName: result.menu?.name ?? null,
    sections: result.sections.map((section) => ({
      id: section.id ?? `section-${section.name}`,
      name: section.name,
      description: section.description,
      items: section.products.map(fromMenuProduct),
    })),
  };
}

/**
 * One cache entry per branch — they are different menus, not one menu filtered.
 *
 * The key names the *shape* as well as the branch. The product page caches the
 * same branch's menu in its own, rawer form, and two entries keyed only by
 * branch id would be one collision away from handing a page a payload it does
 * not understand — with no error, just a page that quietly renders nothing.
 */
const cachedBranchMenu = (branchId, orderType) =>
  unstable_cache(() => loadBranchMenu(branchId, orderType), ["menu-page-sections", branchId, orderType], {
    revalidate: BRANCH_MENU_REVALIDATE,
    tags: [CacheTag.MENUS, CacheTag.CATALOG],
  })();

async function loadCatalogMenu() {
  const [categories, productPage] = await Promise.all([
    publicCategories(),
    publicProducts({ limit: 100 }),
  ]);

  const items = productPage.items.map(fromCatalogProduct);

  // Grouped by category, which is the only structure the catalog has — branch
  // menus bring their own sections, and those are richer.
  const sections = categories
    .map((category) => ({
      id: category.id,
      name: category.name,
      description: category.description,
      items: items.filter((item) => item.categoryName === category.name),
    }))
    .filter((section) => section.items.length > 0);

  return { reason: null, menuName: null, sections };
}

const cachedCatalogMenu = unstable_cache(loadCatalogMenu, ["catalog-menu"], {
  revalidate: CATALOG_REVALIDATE,
  tags: [CacheTag.CATALOG],
});

/**
 * @param branch  the resolved outlet, or null when none is chosen or configured
 */
export async function getMenuPageData({ branch = null, orderType = "DELIVERY" } = {}) {
  const [menuResult, settingsResult] = await Promise.allSettled([
    branch ? cachedBranchMenu(branch.id, orderType) : cachedCatalogMenu(),
    // Branch-scoped: several of these are overridable per outlet, prep time
    // among them, and the banner that quotes it has to quote the right one.
    getSettings({ branchId: branch?.id ?? null, publicOnly: true }),
  ]);

  let source = branch ? "branch" : "catalog";
  let menu = { reason: null, menuName: null, sections: [] };
  // Distinguishes "this menu is empty" from "we could not read it". They look
  // identical in the data and could not be less alike to a customer, so the
  // page is told which one it is rather than left to guess from a zero.
  let failed = false;

  if (menuResult.status === "fulfilled") {
    menu = menuResult.value;
  } else {
    logger.error("menu read failed, falling back to the catalog", {
      branchId: branch?.id ?? null,
      error: menuResult.reason?.message ?? String(menuResult.reason),
    });

    // A branch menu that cannot be read is worth falling back for — an empty
    // menu page is worse than one with indicative prices on it, as long as it
    // says which it is.
    try {
      menu = await cachedCatalogMenu();
      source = "catalog";
    } catch (error) {
      logger.error("catalog fallback failed too", { error: error?.message || String(error) });
      failed = true;
    }
  }

  // A branch with no menu scheduled right now still has a catalog behind it.
  if (source === "branch" && menu.sections.length === 0) {
    try {
      const catalog = await cachedCatalogMenu();
      if (catalog.sections.length) {
        return buildPayload({
          source: "catalog",
          branch,
          orderType,
          reason: menu.reason,
          menu: catalog,
          settingsResult,
        });
      }
    } catch {
      // Keep the branch result, empty as it is; the page renders its own
      // empty state and says why.
    }
  }

  return buildPayload({ source, branch, orderType, reason: menu.reason, menu, settingsResult, failed });
}

function buildPayload({ source, branch, orderType, reason, menu, settingsResult, failed = false }) {
  const settings = settingsResult.status === "fulfilled" ? settingsResult.value : {};

  const sections = menu.sections;
  const allItems = sections.flatMap((section) => section.items);

  return {
    source,
    failed,
    branch: branch
      ? {
          id: branch.id,
          code: branch.code,
          name: branch.name,
          city: branch.city,
          openState: branch.openState ?? null,
        }
      : null,
    // The order type these prices were resolved for, so the page can notice
    // when the cart has since switched and fetch the right ones.
    orderType,
    reason,
    menuName: menu.menuName,
    currency: branch?.currency || settings["store.currency"] || "PKR",
    storeName: settings["store.name"] || "FoodZone",
    prepMinutes: settings["ordering.default_prep_minutes"] ?? null,
    orderingEnabled: settings["ordering.enabled"] !== false,
    sections,
    // The mockup's lead rail. Recommended items if anyone has marked some,
    // otherwise the first few — a "chef's picks" strip that is empty because
    // nobody ticked a box is worse than one that shows the top of the menu.
    featured: (allItems.filter((item) => item.isRecommended).length
      ? allItems.filter((item) => item.isRecommended)
      : allItems
    ).slice(0, 3),
    itemCount: allItems.length,
  };
}

export { BRANCH_MENU_REVALIDATE };
