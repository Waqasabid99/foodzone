import Hero from "@/components/home/Hero";
import HomeHero from "@/components/home/HomeHero";
import CategoryRail from "@/components/home/CategoryRail";
import DealOfTheDay from "@/components/home/DealOfTheDay";
import MenuHighlights from "@/components/home/MenuHighlights";
import HowItWorks from "@/components/home/HowItWorks";
import CustomerLove from "@/components/home/CustomerLove";
import CustomerShorts from "@/components/home/CustomerShorts";
import GetTheApp from "@/components/home/GetTheApp";
import { getHomePageData, REVALIDATE_SECONDS } from "@/server/content/home";

/**
 * The home page.
 *
 * Rendered on the server and cached, then re-rendered in the background every
 * `REVALIDATE_SECONDS` — so a visitor is never waiting on a database round trip
 * for a page whose content changes a few times a day, and a rush does not turn
 * into one catalog query per visitor.
 *
 * The literal is spelled out because Next requires this export to be
 * statically analysable — `REVALIDATE_SECONDS` or even `60 * 5` is rejected at
 * build time. Since that forces the number to be written twice, the two are
 * compared below: the segment and the cache entry underneath it have to agree,
 * or the page revalidates on a schedule the data ignores and serves the same
 * cached content with a fresh timestamp on it.
 */
export const revalidate = 300;

if (revalidate !== REVALIDATE_SECONDS) {
  throw new Error(
    `Home page revalidate (${revalidate}s) does not match its cache entry (${REVALIDATE_SECONDS}s). ` +
      "Next requires the segment export to be a literal, so both have to be edited together.",
  );
}

export const metadata = {
  title: "FoodZone — Sizzle & Snap",
  description:
    "Unapologetically bold flavors, crafted for immediate satisfaction. Order burgers, wings, fries and more.",
};

export default async function HomePage() {
  const data = await getHomePageData();

  return (
    <div className="mx-auto max-w-page space-y-16 px-margin-mobile py-6 md:px-margin-desktop md:py-8">
      {/* The banner is server-rendered and paints first; the reorder prompt
          replaces it once the browser knows there is an order worth offering.
          Passing the hero in as children keeps it in the initial HTML, which
          is what keeps the largest contentful paint off a round trip. */}
      <HomeHero currency={data.currency} timeZone={data.timeZone}>
        <Hero slides={data.heroSlides} />
      </HomeHero>

      {/* Navigation before persuasion: "do you do pizza" is the first question,
          and it is answered above the offer rather than below it. */}
      <CategoryRail categories={data.categories.items} isPlaceholder={data.categories.isPlaceholder} />

      <DealOfTheDay deal={data.deal.item} featured={data.featured.items} currency={data.currency} />

      {/* The same card the menu uses, so these add to the real cart. */}
      <MenuHighlights items={data.products} currency={data.currency} />

      <HowItWorks steps={data.howItWorks} />

      <CustomerLove testimonials={data.testimonials.items} />

      {/* Real clips from the chosen outlet, loaded in the browser so this
          page stays static. Replaces a placeholder Instagram grid that was
          four pieces of branded artwork pretending to be posts. */}
      <CustomerShorts />

      <GetTheApp storeName={data.storeName} />

    </div>
  );
}
