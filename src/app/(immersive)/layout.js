import Header from "@/components/layout/Header";
import { getSiteIdentity } from "@/server/content/site";
import { getPublicBranches } from "@/server/content/branches";

/**
 * Storefront chrome for a page that owns the whole screen.
 *
 * The header and nothing else. A full-bleed feed is one viewport tall and
 * fixed, so everything the site footer carries — the newsletter sign-up, five
 * columns of links — sat underneath it with no way to reach it except by
 * scrolling past a feed that is itself a scroll container. A sign-up form
 * nobody can see is not a sign-up form, and a swipe that fights the page is
 * worse than no footer at all.
 *
 * Its own route group rather than a nested layout, because a nested one adds
 * to its parent and there is no way to subtract the footer from inside
 * `(site)`. The URL is unaffected: route groups are not path segments.
 */
export default async function ImmersiveLayout({ children }) {
  const [{ storeName, currency }, branches] = await Promise.all([getSiteIdentity(), getPublicBranches()]);

  return (
    <div className="flex min-h-full flex-col">
      <Header storeName={storeName} branches={branches} currency={currency} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
