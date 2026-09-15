import { unstable_cache } from "next/cache";
import { CacheTag } from "@/lib/cache-tags";
import { publicProduct, publicProducts } from "@/server/services/catalog.service";
import { productReviews } from "@/server/services/review.service";
import { getBranchMenu } from "@/server/services/menu.service";
import { getSettings } from "@/server/services/setting.service";
import { logger } from "@/lib/logger";

/**
 * Everything a product page renders.
 *
 * The structure — variants, modifier groups and their rules, combo slots —
 * comes from the catalog, because that is where it lives. The *prices* come
 * from the selected branch's live menu whenever there is one, because that is
 * what the customer will actually be charged: a menu may override a price per
 * outlet, and showing the catalog figure next to an Add button that charges
 * something else is the single most damaging thing this page could do.
 *
 * Where the two disagree, the branch wins and `priceSource` says so, so the
 * page can be explicit about whether a price is confirmed or indicative.
 */

/** Short, like the menu: staff toggle availability from the kitchen mid-service. */
const BRANCH_REVALIDATE = 60;
const CATALOG_REVALIDATE = 300;

const cachedProduct = (slug) =>
  unstable_cache(() => publicProduct(slug), ["product", slug], {
    revalidate: CATALOG_REVALIDATE,
    tags: [CacheTag.CATALOG],
  })();

const cachedRelated = (categorySlug, excludeId) =>
  unstable_cache(
    async () => {
      const page = await publicProducts({ category: categorySlug, limit: 9 });
      return page.items.filter((item) => item.id !== excludeId).slice(0, 4);
    },
    ["related-products", categorySlug, excludeId],
    { revalidate: CATALOG_REVALIDATE, tags: [CacheTag.CATALOG] },
  )();

/**
 * The raw branch menu, kept under its own key.
 *
 * The menu page caches a transformed view of the same read; sharing a key
 * between two different shapes is a silent failure waiting to happen, so each
 * says which shape it holds.
 */
const cachedBranchPricing = (branchId) =>
  unstable_cache(() => getBranchMenu({ branchIdOrCode: branchId }), ["branch-menu-raw", branchId], {
    revalidate: BRANCH_REVALIDATE,
    tags: [CacheTag.MENUS, CacheTag.CATALOG],
  })();

/**
 * Overlays the branch menu's prices and availability onto the catalog variants.
 *
 * A variant the branch does not carry is marked unavailable rather than
 * dropped: "this size isn't served here" is information, and silently removing
 * it leaves someone hunting for the option they saw on the menu page.
 */
function applyBranchPricing(product, branchMenu) {
  const onMenu = branchMenu.sections
    .flatMap((section) => section.products)
    .find((entry) => entry.productId === product.id);

  if (!onMenu) {
    return {
      variants: product.variants.map((variant) => ({ ...variant, price: Number(variant.price), available: false })),
      priceSource: "catalog",
      onBranchMenu: false,
    };
  }

  const byVariant = new Map(onMenu.variants.map((variant) => [variant.variantId, variant]));

  return {
    variants: product.variants.map((variant) => {
      const menuVariant = byVariant.get(variant.id);
      return {
        ...variant,
        price: menuVariant ? menuVariant.price : Number(variant.price),
        compareAtPrice:
          menuVariant?.compareAtPrice ?? (variant.compareAtPrice != null ? Number(variant.compareAtPrice) : null),
        available: menuVariant ? menuVariant.available : false,
      };
    }),
    priceSource: "branch",
    onBranchMenu: true,
  };
}

export async function getProductPageData({ slug, branch = null }) {
  const product = await cachedProduct(slug);

  const [reviewsResult, relatedResult, branchResult, settingsResult] = await Promise.allSettled([
    productReviews({ productId: product.id, limit: 6 }),
    product.category?.slug ? cachedRelated(product.category.slug, product.id) : Promise.resolve([]),
    branch ? cachedBranchPricing(branch.id) : Promise.resolve(null),
    getSettings({ branchId: branch?.id ?? null, publicOnly: true }),
  ]);

  for (const [name, result] of [
    ["reviews", reviewsResult],
    ["related products", relatedResult],
    ["branch pricing", branchResult],
    ["settings", settingsResult],
  ]) {
    if (result.status === "rejected") {
      logger.error("product page section failed", {
        section: name,
        slug,
        error: result.reason?.message ?? String(result.reason),
      });
    }
  }

  const settings = settingsResult.status === "fulfilled" ? settingsResult.value : {};
  const branchMenu = branchResult.status === "fulfilled" ? branchResult.value : null;

  const pricing = branchMenu
    ? applyBranchPricing(product, branchMenu)
    : {
        variants: product.variants.map((variant) => ({
          ...variant,
          price: Number(variant.price),
          compareAtPrice: variant.compareAtPrice != null ? Number(variant.compareAtPrice) : null,
          available: true,
        })),
        priceSource: "catalog",
        onBranchMenu: false,
      };

  const reviews =
    reviewsResult.status === "fulfilled"
      ? reviewsResult.value
      : { items: [], summary: { average: null, count: 0, distribution: {} } };

  return {
    product: {
      ...product,
      variants: pricing.variants,
      // Decimals cross into client components as numbers, never as Decimal
      // instances — those do not survive serialisation.
      modifierGroups: (product.modifierGroups ?? []).map((group) => ({
        ...group,
        options: group.options.map((option) => ({ ...option, priceDelta: Number(option.priceDelta) })),
      })),
      comboGroups: (product.comboGroups ?? []).map((group) => ({
        ...group,
        options: group.options.map((option) => ({
          ...option,
          priceDelta: Number(option.priceDelta),
          variant: option.variant ? { ...option.variant, price: Number(option.variant.price) } : null,
        })),
      })),
    },
    priceSource: pricing.priceSource,
    onBranchMenu: pricing.onBranchMenu,
    branch: branch ? { id: branch.id, name: branch.name } : null,
    currency: branch?.currency || settings["store.currency"] || "PKR",
    prepMinutes: settings["ordering.default_prep_minutes"] ?? null,
    reviews,
    related: relatedResult.status === "fulfilled" ? relatedResult.value : [],
  };
}
