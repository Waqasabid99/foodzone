import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, Plus, Star } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import MenuFilters from "@/components/dashboard/menus/MenuFilters";
import MenuStatusChip from "@/components/dashboard/menus/MenuStatusChip";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { menuOverview, scopedBranches } from "@/server/content/menu-admin";
import { MENU_TYPES, describeSchedule, menuTypeLabel } from "@/lib/menu-schedule";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = {
  title: "Menus — FoodZone",
  robots: { index: false, follow: false },
};

/** Live state depends on the clock, so nothing here may be cached. */
export const dynamic = "force-dynamic";

/**
 * Every menu this person may see, grouped by branch, with whether customers
 * are seeing it right now.
 */
export default async function MenusPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/menus"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "menus.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);

  const [branches, creatable] = await Promise.all([
    scopedBranches(principal, "menus.read"),
    scopedBranches(principal, "menus.create"),
  ]);
  const branchId = branches.some((branch) => branch.id === one(params.branch)) ? one(params.branch) : "";
  const type = MENU_TYPES.some((entry) => entry.value === one(params.type)) ? one(params.type) : "";

  const { menus, truncated } = await menuOverview({ principal, branchId: branchId || null, type: type || null });

  const groups = [];
  for (const menu of menus) {
    const last = groups.at(-1);
    if (last?.branch.id === menu.branch.id) last.menus.push(menu);
    else groups.push({ branch: menu.branch, menus: [menu] });
  }

  const filtered = Boolean(branchId || type);
  const newHref = branchId && creatable.some((branch) => branch.id === branchId) ? `/dashboard/menus/new?branch=${branchId}` : "/dashboard/menus/new";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Menus"
        description="What each branch sells, on which channel and when — and which menu customers are seeing right now."
        actions={
          creatable.length ? (
            <Link href={newHref} className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-3 font-display text-label-bold uppercase tracking-wide text-on-primary-container transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <Plus aria-hidden="true" className="size-4" />
              New menu
            </Link>
          ) : null
        }
      />

      <MenuFilters branch={branchId} type={type} branches={branches} />

      {truncated ? (
        <p className="rounded-card bg-warning-container px-5 py-3 text-body-md text-on-warning-container">
          Showing the first 500 menus. Choose a branch to see the rest.
        </p>
      ) : null}

      {groups.length ? (
        groups.map(({ branch, menus: rows }) => (
          <section key={branch.id} aria-labelledby={`branch-${branch.id}`} className="flex flex-col gap-2">
            <h2 id={`branch-${branch.id}`} className="flex flex-wrap items-baseline gap-2 font-display text-headline-md text-on-surface">
              {branch.name}
              {!branch.isActive ? <span className="text-label-bold font-normal text-on-surface-variant">Branch not trading — none of its menus show</span> : null}
            </h2>
            <div className="overflow-x-auto rounded-card bg-surface-container-lowest">
              <table className="w-full text-left text-body-md">
                <caption className="sr-only">Menus at {branch.name}</caption>
                <thead>
                  <tr className="border-b border-outline-variant text-label-bold text-on-surface-variant">
                    <th scope="col" className="px-4 py-3 font-normal">Menu</th>
                    <th scope="col" className="hidden px-4 py-3 font-normal md:table-cell">When</th>
                    <th scope="col" className="hidden px-4 py-3 text-right font-normal sm:table-cell">Products</th>
                    <th scope="col" className="px-4 py-3 font-normal">Right now</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((menu) => (
                    <tr key={menu.id} className="border-b border-outline-variant/60 align-top last:border-0">
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/menus/${menu.id}`} className="text-label-bold text-on-surface hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                          {menu.name}
                        </Link>
                        <p className="flex flex-wrap items-center gap-x-2 text-on-surface-variant">
                          {menuTypeLabel(menu.type)}
                          {menu.isDefault ? (
                            <span className="inline-flex items-center gap-1">
                              <Star aria-hidden="true" className="size-3.5" />
                              Fallback
                            </span>
                          ) : null}
                        </p>
                        <p className="text-on-surface-variant md:hidden">{describeSchedule(menu, branch.timezone)}</p>
                      </td>
                      <td className="hidden px-4 py-3 text-on-surface-variant md:table-cell">{describeSchedule(menu, branch.timezone)}</td>
                      <td className="hidden px-4 py-3 text-right tabular-nums text-on-surface-variant sm:table-cell">{menu.productCount}</td>
                      <td className="px-4 py-3">
                        <MenuStatusChip live={menu.live} />
                        {menu.live.by ? <p className="mt-1 text-on-surface-variant">“{menu.live.by}” is showing</p> : null}
                        {!menu.productCount ? <p className="mt-1 text-label-bold text-error">Empty</p> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-card bg-surface-container-lowest px-6 py-16 text-center">
          <BookOpen aria-hidden="true" className="size-8 text-on-surface-variant" />
          <p className="font-display text-headline-md text-on-surface">{filtered ? "No menus match that" : "No menus yet"}</p>
          <p className="max-w-md text-body-md text-on-surface-variant">
            {filtered
              ? "Try another branch or channel."
              : "A branch can only take orders for what is on one of its menus. Create one, add products, then switch it on."}
          </p>
          {filtered ? <Link href="/dashboard/menus" className="text-label-bold text-primary hover:underline">Clear filters</Link> : null}
        </div>
      )}
    </div>
  );
}
