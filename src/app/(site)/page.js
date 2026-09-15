import Hero from "@/components/home/Hero";
import DealOfTheDay from "@/components/home/DealOfTheDay";
import HowItWorks from "@/components/home/HowItWorks";
import CustomerLove from "@/components/home/CustomerLove";
import SocialSnap from "@/components/home/SocialSnap";
import GetTheApp from "@/components/home/GetTheApp";
import BoldClub from "@/components/home/BoldClub";
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
      <Hero />

      <DealOfTheDay deal={data.deal.item} featured={data.featured.items} currency={data.currency} />

      <HowItWorks steps={data.howItWorks} />

      <CustomerLove testimonials={data.testimonials.items} />

      <SocialSnap posts={data.social.items} />

      <GetTheApp storeName={data.storeName} />

      <BoldClub />
    </div>
  );
}
