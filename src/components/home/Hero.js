import Link from "next/link";
import FoodImage from "@/components/ui/FoodImage";

/**
 * The hero.
 *
 * Text sits on top of photography, so it carries its own scrim rather than
 * trusting the image: the gradient guarantees the contrast the headline needs
 * whatever product photo ends up behind it, including a bright one.
 */
export default function Hero({ imageUrl = null }) {
  return (
    <section className="relative isolate overflow-hidden rounded-banner">
      <div className="absolute inset-0 -z-10">
        <FoodImage
          src={imageUrl}
          alt=""
          priority
          sizes="(max-width: 1280px) 100vw, 1280px"
          className="size-full"
        />
        {/* Left-weighted so the copy stays legible while the food stays visible. */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/60 to-black/20" />
      </div>

      <div className="max-w-xl px-6 py-20 sm:px-10 md:py-28">
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
