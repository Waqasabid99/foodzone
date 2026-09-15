import { unstable_cache } from "next/cache";
import { CacheTag } from "@/lib/cache-tags";
import { logger } from "@/lib/logger";
import { publicCategories, publicProducts } from "@/server/services/catalog.service";
import { listReviews } from "@/server/services/review.service";
import { getSettings } from "@/server/services/setting.service";
import {
  PLACEHOLDER_CATEGORIES,
  PLACEHOLDER_DEAL,
  PLACEHOLDER_FEATURED,
  PLACEHOLDER_REVIEWS,
  PLACEHOLDER_SOCIAL,
  HOW_IT_WORKS,
} from "@/server/content/placeholders";

/**
 * Everything the home page renders, in one cached read.
 *
 * Written against the real services from the start rather than against a fixed
 * blob of sample content. The catalog is empty today, so each section falls
 * back to a placeholder — but the query is the real one, which means the page
 * starts showing actual products the moment somebody adds one, with no second
 * pass over this code. Building it the other way round leaves a rewrite sitting
 * between "it looks right" and "it works".
 *
 * Caching: one `unstable_cache` entry for the whole page rather than one per
 * section. The sections are always rendered together, so separate entries would
 * buy nothing and could serve a page assembled from two different moments —
 * a deal priced from one revalidation next to a product priced from another.
 *
 * Tagged as well as timed. Time-based revalidation is what is wired up now;
 * the tags mean that adding `revalidateTag(CacheTag.CATALOG)` to the admin
 * mutation routes later makes a price change appear in seconds, without
 * touching this file.
 */

/** Five minutes: long enough to absorb a rush, short enough that a price fix lands. */
const REVALIDATE_SECONDS = 300;

/** Trims a product down to what a card actually shows. */
function toCard(product) {
  const variant = product.defaultVariant ?? product.variants?.[0] ?? null;

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    shortDescription: product.shortDescription ?? null,
    imageUrl: product.imageUrl ?? null,
    dietary: product.dietary ?? [],
    spiceLevel: product.spiceLevel ?? null,
    // `priceFrom` is already a number; `compareAtPrice` is a Decimal off the
    // variant and has to be flattened before it crosses into a component.
    priceFrom: product.priceFrom ?? null,
    compareAtPrice: variant?.compareAtPrice ? Number(variant.compareAtPrice) : null,
  };
}

function toTestimonial(review) {
  return {
    id: review.id,
    rating: review.rating,
    comment: review.comment,
    authorName: review.user?.name ?? "A customer",
    productName: review.product?.name ?? null,
  };
}

/**
 * The deal is the best saving on offer — the largest gap between a product's
 * price and its struck-through compare-at price.
 *
 * Derived rather than curated because there is no "deal of the day" concept in
 * the schema yet. When one arrives (a promotion flagged for the home page, say)
 * this is the single function that changes.
 */
function pickDeal(cards) {
  const discounted = cards
    .filter((card) => card.compareAtPrice && card.priceFrom && card.compareAtPrice > card.priceFrom)
    .sort((a, b) => b.compareAtPrice - b.priceFrom - (a.compareAtPrice - a.priceFrom));

  return discounted[0] ?? cards[0] ?? null;
}

async function loadHome() {
  // Settled individually: an empty catalog is the expected state right now, and
  // one failing read should cost its own section, not the whole page.
  const [settingsResult, categoriesResult, featuredResult, catalogResult, reviewsResult] =
    await Promise.allSettled([
      getSettings({ publicOnly: true }),
      publicCategories(),
      publicProducts({ featured: true, limit: 8 }),
      publicProducts({ limit: 8 }),
      listReviews({ status: "PUBLISHED", limit: 6 }),
    ]);

  // Settling each read keeps one bad section from taking the page down, but it
  // also hides a broken query behind a placeholder that looks deliberate — a
  // wrong enum value in one of these shipped exactly that way once. So every
  // rejection is logged, loudly enough to find in a build log.
  for (const [name, result] of [
    ["settings", settingsResult],
    ["categories", categoriesResult],
    ["featured products", featuredResult],
    ["catalog", catalogResult],
    ["reviews", reviewsResult],
  ]) {
    if (result.status === "rejected") {
      logger.error("home page section failed, falling back to placeholder", {
        section: name,
        error: result.reason?.message ?? String(result.reason),
      });
    }
  }

  const settings = settingsResult.status === "fulfilled" ? settingsResult.value : {};
  const currency = settings["store.currency"] ?? "PKR";
  const storeName = settings["store.name"] || "FoodZone";

  const categories = categoriesResult.status === "fulfilled" ? categoriesResult.value : [];

  // Featured products are the intent; anything published is the fallback, so a
  // catalog nobody has curated yet still fills the page.
  const featuredRows = featuredResult.status === "fulfilled" ? featuredResult.value.items : [];
  const catalogRows = catalogResult.status === "fulfilled" ? catalogResult.value.items : [];
  const productRows = featuredRows.length ? featuredRows : catalogRows;
  const cards = productRows.map(toCard);

  const reviewRows = reviewsResult.status === "fulfilled" ? reviewsResult.value.items : [];
  // Only reviews that say something are worth a testimonial slot.
  const testimonials = reviewRows.filter((review) => review.comment?.trim()).slice(0, 3).map(toTestimonial);

  const deal = pickDeal(cards);

  return {
    storeName,
    currency,
    generatedAt: new Date().toISOString(),

    categories: categories.length
      ? { items: categories.slice(0, 8), isPlaceholder: false }
      : { items: PLACEHOLDER_CATEGORIES, isPlaceholder: true },

    deal: deal ? { item: deal, isPlaceholder: false } : { item: PLACEHOLDER_DEAL, isPlaceholder: true },

    // The deal already has the top slot, so the rail beside it shows what comes next.
    featured: cards.length
      ? { items: cards.filter((card) => card.id !== deal?.id).slice(0, 3), isPlaceholder: false }
      : { items: PLACEHOLDER_FEATURED, isPlaceholder: true },

    testimonials: testimonials.length
      ? { items: testimonials, isPlaceholder: false }
      : { items: PLACEHOLDER_REVIEWS, isPlaceholder: true },

    social: { items: PLACEHOLDER_SOCIAL, isPlaceholder: true },
    howItWorks: HOW_IT_WORKS,
  };
}

export const getHomePageData = unstable_cache(loadHome, ["home-page"], {
  revalidate: REVALIDATE_SECONDS,
  tags: [CacheTag.HOME, CacheTag.CATALOG, CacheTag.REVIEWS, CacheTag.SETTINGS],
});

export { REVALIDATE_SECONDS };
