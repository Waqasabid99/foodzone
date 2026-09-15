import { cookies } from "next/headers";
import MenuBrowser from "@/components/menu/MenuBrowser";
import MenuItemCard from "@/components/menu/MenuItemCard";
import GuaranteeBanner from "@/components/menu/GuaranteeBanner";
import { getPublicBranches } from "@/server/content/branches";
import { getMenuPageData } from "@/server/content/menu";
import { BRANCH_COOKIE, resolveBranch } from "@/lib/branch";

export const metadata = {
  title: "The Bold Menu — FoodZone",
  description:
    "Flame-seared, smashed to perfection, and stacked high. Browse burgers, loaded fries, craft shakes and more.",
};

/**
 * The menu.
 *
 * Rendered per request rather than prerendered, and deliberately so: it depends
 * on which outlet the visitor chose, on that outlet's clock — menus are
 * scheduled, so breakfast becomes lunch at a time this page has to respect —
 * and on items staff have taken off mid-service. The expensive reads underneath
 * are cached for a minute each, which is what absorbs a rush without letting a
 * sold-out burger stay orderable.
 */
export default async function MenuPage() {
  const [branches, cookieStore] = await Promise.all([getPublicBranches(), cookies()]);

  // The cookie is a hint; the branch list is the authority. A cookie naming a
  // closed or deleted outlet resolves to nothing, and a single-outlet
  // restaurant resolves to its only branch without anyone choosing.
  const branch = resolveBranch(branches, cookieStore.get(BRANCH_COOKIE)?.value ?? null);
  const data = await getMenuPageData({ branch });

  return (
    <div className="mx-auto max-w-page space-y-12 px-margin-mobile py-6 md:px-margin-desktop md:py-8">
      <MenuBrowser
        data={data}
        canChooseBranch={branches.length > 1}
        orderingAvailable={branches.length > 0}
      />

      {data.featured.length ? (
        <section aria-labelledby="sizzle-favorites">
          <p className="text-label-bold uppercase tracking-widest text-primary">
            Chef&apos;s high-heat cravings
          </p>
          <h2
            id="sizzle-favorites"
            className="mt-2 font-display text-headline-md uppercase text-on-surface"
          >
            Sizzle favorites
          </h2>

          <div className="mt-5 grid gap-5 lg:grid-cols-3">
            {data.featured.map((item, index) => (
              <div key={item.id} className={index === 0 ? "lg:col-span-2" : ""}>
                <MenuItemCard
                  item={item}
                  currency={data.currency}
                  branchId={data.branch?.id ?? null}
                  canChooseBranch={branches.length > 1}
                  orderingAvailable={branches.length > 0}
                  size={index === 0 ? "lg" : "md"}
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <GuaranteeBanner minutes={data.prepMinutes} branchName={data.branch?.name ?? null} />
    </div>
  );
}
