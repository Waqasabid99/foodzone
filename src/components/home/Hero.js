import Link from "next/link";
import HeroCarousel from "@/components/home/HeroCarousel";
import HeroBackdrop, { HERO_BODY, HERO_FRAME } from "@/components/home/HeroBackdrop";

/**
 * The hero.
 *
 * Text sits on top of photography, so it carries its own scrim rather than
 * trusting the image: the gradient guarantees the contrast the headline needs
 * whatever product photo ends up behind it, including a bright one.
 *
 * Two versions of the same shape. With banners scheduled, it is the shop's
 * front window and the words are whatever marketing wrote. With none, it falls
 * back to the standard opening below — which is the honest default, because a
 * shop with no campaign running should say what it is rather than advertise an
 * offer that does not exist.
 *
 * **Server-rendered either way.** This is the largest contentful paint on the
 * site, and the home page is statically cached; loading the banner in the
 * browser would trade the one measurement that matters for a feature that does
 * not need it.
 */
export default function Hero({ slides = [], imageUrl = null }) {
  if (slides.length) return <HeroCarousel slides={slides} />;

  return (
    <section className={HERO_FRAME}>
      <HeroBackdrop src={imageUrl} priority />

      <div className={HERO_BODY}>
        <h1 className="font-display text-headline-lg-mobile leading-none md:text-display-lg">
          <span className="block text-primary-container">SIZZLE</span>
          <span className="block text-white">&amp; SNAP</span>
        </h1>

        <p className="mt-6 max-w-md text-body-md text-white/85">
          Unapologetically bold flavors, crafted for immediate satisfaction. Experience the crunch,
          taste the fire.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/menu"
            className="rounded-full bg-primary-container px-8 py-3 font-display text-label-bold text-on-primary-container transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Order Now
          </Link>
          <Link
            href="/menu"
            className="rounded-full border-2 border-white/80 px-8 py-3 font-display text-label-bold text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            View Menu
          </Link>
        </div>
      </div>
    </section>
  );
}
