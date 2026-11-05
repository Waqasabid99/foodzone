import Link from "next/link";

export const metadata = { title: "Page not found — FoodZone" };

/**
 * The last-resort 404.
 *
 * Reached only by a URL that matches no route group at all — a path of two or
 * more unknown segments, say `/old/brochure`. Anything with a single unknown
 * segment falls through to `(site)/[slug]`, which 404s inside the storefront
 * and gets the header, the footer and a route back.
 *
 * So this has no chrome, because there is none to inherit: it renders directly
 * inside the root layout, which deliberately carries no navigation. It does
 * get the stylesheet and the theme, so it is still the shop's typography and
 * the visitor's chosen colours rather than a browser default.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-surface px-6 py-24 text-center">
      <p className="font-display text-headline-lg text-primary">404</p>

      <h1 className="font-display text-headline-md text-on-surface">We could not find that page</h1>

      <p className="max-w-md text-body-lg text-on-surface-variant">
        The address might be mistyped, or whatever was here has moved.
      </p>

      <Link
        href="/"
        className="mt-2 rounded-full bg-primary px-6 py-3 font-display text-label-bold uppercase tracking-wide text-on-primary transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Go to FoodZone
      </Link>
    </div>
  );
}
