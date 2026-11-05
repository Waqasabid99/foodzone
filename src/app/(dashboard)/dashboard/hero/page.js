import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import HeroSlides from "@/components/dashboard/hero/HeroSlides";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listHeroSlides } from "@/server/services/hero.service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";
import { getSiteIdentity } from "@/server/content/site";

export const metadata = { title: "Home page banners — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The front window.
 *
 * Company data rather than branch data: the home page is one page, cached and
 * served to everybody, so a banner is a decision for whoever runs marketing
 * rather than for an outlet. See the model for why there is no `branchId`.
 */
export default async function HeroPage() {
  const { timeZone } = await getSiteIdentity();
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/hero"));

  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "hero_slides.read")) redirect("/dashboard");

  const slides = serialize(await listHeroSlides());

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Home page banners"
        description="What a visitor sees first. Banners run in the order below; the top one that is live is the one they land on. With none live, the home page shows its standard opening."
      />
      <HeroSlides slides={slides} canManage={hasPermission(permissions, "hero_slides.manage")} timeZone={timeZone} />
    </div>
  );
}
