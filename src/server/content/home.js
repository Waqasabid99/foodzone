import { unstable_cache } from "next/cache";
import { CacheTag } from "@/lib/cache-tags";
import { logger } from "@/lib/logger";
import { publicCategories, publicProducts } from "@/server/services/catalog.service";
import { listReviews } from "@/server/services/review.service";
import { getSettings } from "@/server/services/setting.service";
import { liveHeroSlides } from "@/server/services/hero.service";
import { toMenuCard } from "@/lib/menu-card";
import {
  PLACEHOLDER_CATEGORIES,
  PLACEHOLDER_DEAL,
  PLACEHOLDER_FEATURED,
  PLACEHOLDER_REVIEWS,
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
  const [settingsResult, categoriesResult, featuredResult, catalogResult, reviewsResult, slidesResult] =
    await Promise.allSettled([
      getSettings({ publicOnly: true }),
      publicCategories(),
      publicProducts({ featured: true, limit: 8 }),
      // More than the page shows: the grid takes what is left after the deal
      // and the two beside it, and a limit of exactly eight leaves five.
      publicProducts({ limit: 16 }),
      listReviews({ status: "PUBLISHED", limit: 6 }),
      liveHeroSlides(),
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
    ["heroSlides", slidesResult],
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
  const timeZone = settings["store.timezone"] || "UTC";
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
  // The deal has the big slot; these are the cards beside it.
  const rail = cards.filter((card) => card.id !== deal?.id).slice(0, 3);
  const slides = slidesResult.status === "fulfilled" ? slidesResult.value : [];

  /*
   * The orderable grid.
   *
   * Drawn from the whole published catalog rather than from the featured list,
   * because "featured" is already spoken for above — the deal and the two
   * beside it — and a home page that shows the same burger three times is a
   * shop that looks like it sells one thing. Anything already on the page is
   * taken out rather than deduplicated afterwards.
   */
  const spokenFor = new Set([deal?.id, ...rail.map((card) => card.id)].filter(Boolean));
  const grid = catalogRows
    .filter((row) => !spokenFor.has(row.id))
    .map(toMenuCard)
    .slice(0, 8);

  return {
    storeName,
    currency,
    timeZone,
    generatedAt: new Date().toISOString(),

    categories: categories.length
      ? { items: categories.slice(0, 8), isPlaceholder: false }
      : { items: PLACEHOLDER_CATEGORIES, isPlaceholder: true },

    deal: deal ? { item: deal, isPlaceholder: false } : { item: PLACEHOLDER_DEAL, isPlaceholder: true },

    // The deal already has the top slot, so the rail beside it shows what comes next.
    featured: cards.length ? { items: rail, isPlaceholder: false } : { items: PLACEHOLDER_FEATURED, isPlaceholder: true },

    testimonials: testimonials.length
      ? { items: testimonials, isPlaceholder: false }
      : { items: PLACEHOLDER_REVIEWS, isPlaceholder: true },

    /*
     * No placeholder, like the hero and for the same reason: these cards add to
     * a real cart. Invented dishes would be a shop window of things nobody can
     * buy, each linking to a product page that does not exist.
     */
    products: grid,

    howItWorks: HOW_IT_WORKS,

    /*
     * The front window, or nothing.
     *
     * No placeholder here, deliberately. Every other section falls back to
     * branded artwork because an empty row looks broken; the hero is the one
     * that already has a designed default behind it — the standard opening —
     * and inventing a fake campaign would be the shop advertising an offer it
     * is not running.
     */
    heroSlides: slides,
  };
}

export const getHomePageData = unstable_cache(loadHome, ["home-page"], {
  revalidate: REVALIDATE_SECONDS,
  tags: [CacheTag.HOME, CacheTag.CATALOG, CacheTag.REVIEWS, CacheTag.SETTINGS],
});

export { REVALIDATE_SECONDS };
