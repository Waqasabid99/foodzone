import Link from "next/link";
import { SearchX } from "lucide-react";

export const metadata = { title: "Page not found — FoodZone" };

/**
 * A 404 that still looks like the shop.
 *
 * Inside `(site)`, so it renders with the header, the footer and the cart — a
 * customer who mistypes a URL stays in a place they recognise with a way back,
 * rather than landing on a black-and-white browser-default page that reads as
 * "this website is broken" rather than "that address was wrong".
 *
 * This catches more than it looks like it does. Any unmatched single-segment
 * URL falls through to `[slug]`, which calls `notFound()` when no content page
 * owns it, so `/privacyy` lands here rather than on the bare root fallback.
 *
 * Deliberately offers the menu rather than a search box: there is no search,
 * and a box that does nothing is a second broken thing on a page about the
 * first one.
 */
export default function SiteNotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-5 px-margin-mobile py-24 text-center md:px-margin-desktop">
      <SearchX aria-hidden="true" className="size-12 text-primary" />

      <h1 className="font-display text-headline-lg text-on-surface">We could not find that page</h1>

      <p className="text-body-lg text-on-surface-variant">
        The address might be mistyped, or whatever was here has moved. Nothing is wrong with your order.
      </p>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/menu"
          className="rounded-full bg-primary px-6 py-3 font-display text-label-bold uppercase tracking-wide text-on-primary transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          See the menu
        </Link>
        <Link
          href="/"
          className="rounded-full bg-surface-container-high px-6 py-3 font-display text-label-bold uppercase tracking-wide text-on-surface transition-colors hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Go home
        </Link>
      </div>

      <p className="text-body-md text-on-surface-variant">
        Looking for an order you placed?{" "}
        <Link href="/account" className="underline underline-offset-4">
          It is in your account
        </Link>
        .
      </p>
    </div>
  );
}
