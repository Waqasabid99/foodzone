import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { getSiteIdentity } from "@/server/content/site";
import { getPublicBranches } from "@/server/content/branches";
import { getFooterCategories } from "@/server/content/categories";

/**
 * The storefront: everything a customer sees before they sign in to anything.
 *
 * All three reads are cached and none of them touches cookies or headers, so
 * this layout stays compatible with static rendering — the home page is still
 * prerendered underneath it.
 */
export default async function SiteLayout({ children }) {
  const [{ storeName, tagline, socials }, branches, categories] = await Promise.all([
    getSiteIdentity(),
    getPublicBranches(),
    getFooterCategories(),
  ]);

  return (
    <div className="flex min-h-full flex-col">
      <Header storeName={storeName} branches={branches} />
      <main className="flex-1">{children}</main>
      <Footer
        storeName={storeName}
        tagline={tagline}
        socials={socials}
        categories={categories}
        branches={branches}
      />
    </div>
  );
}
