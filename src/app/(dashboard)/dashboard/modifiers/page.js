import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleAlert, Plus, Search, SlidersHorizontal } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import { getWorkspaceViewer } from "@/server/auth/workspace";
import { listModifierGroups } from "@/server/services/modifier.service";
import { describeModifierRule, modifierGroupHealth } from "@/lib/modifier-rules";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = {
  title: "Modifiers — FoodZone",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Reusable choice groups — "Choose a sauce", "Extras" — and whether each one
 * can actually be completed at checkout.
 */
export default async function ModifiersPage({ searchParams }) {
  const viewer = await getWorkspaceViewer();
  if (!viewer) redirect(loginHref("/dashboard/modifiers"));
  if (!hasPermission(viewer.permissions, "modifiers.read")) redirect("/dashboard");

  const { q: raw } = await searchParams;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  const groups = await listModifierGroups(q ? { search: q } : {});
  const canCreate = hasPermission(viewer.permissions, "modifiers.create");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Modifiers"
        description="Choice groups customers fill in when ordering — built once here, then added to as many products as need them."
        actions={
          canCreate ? (
            <Link href="/dashboard/modifiers/new" className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-3 font-display text-label-bold uppercase tracking-wide text-on-primary-container transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <Plus aria-hidden="true" className="size-4" />
              New group
            </Link>
          ) : null
        }
      />

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-card bg-surface-container-lowest p-4">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <label htmlFor="modifier-search" className="text-label-bold text-on-surface">Search</label>
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-on-surface-variant" />
            <input id="modifier-search" name="q" type="search" defaultValue={q} placeholder="Name or internal name" className="w-full rounded-field border border-outline bg-surface-container-low py-2.5 pl-9 pr-3 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring" />
          </div>
        </div>
        <button type="submit" className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest">Search</button>
      </form>

      {groups.length ? (
        <div className="overflow-x-auto rounded-card bg-surface-container-lowest">
          <table className="w-full text-left text-body-md">
            <caption className="sr-only">Modifier groups</caption>
            <thead>
              <tr className="border-b border-outline-variant text-label-bold text-on-surface-variant">
                <th scope="col" className="px-4 py-3 font-normal">Group</th>
                <th scope="col" className="hidden px-4 py-3 font-normal md:table-cell">Rule</th>
                <th scope="col" className="px-4 py-3 text-right font-normal">Choices</th>
                <th scope="col" className="hidden px-4 py-3 text-right font-normal sm:table-cell">Used by</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const issues = modifierGroupHealth(group);
                const blocking = issues.find((issue) => issue.level === "blocking");
                const active = group.options.filter((option) => option.isActive).length;
                return (
                  <tr key={group.id} className="border-b border-outline-variant/60 last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/modifiers/${group.id}`} className="text-label-bold text-on-surface hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                        {group.name}
                      </Link>
                      {group.internalName ? <p className="text-on-surface-variant">{group.internalName}</p> : null}
                      {!group.isActive ? <p className="text-label-bold font-normal text-on-surface-variant">Switched off</p> : null}
                      {blocking ? (
                        <p className="mt-1 flex items-start gap-1 text-label-bold text-error">
                          <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                          {blocking.message}
                        </p>
                      ) : null}
                    </td>
                    <td className="hidden px-4 py-3 text-on-surface-variant md:table-cell">{describeModifierRule(group)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-on-surface">
                      {active}
                      {active !== group.options.length ? <span className="text-on-surface-variant"> of {group.options.length}</span> : null}
                    </td>
                    <td className="hidden px-4 py-3 text-right tabular-nums text-on-surface-variant sm:table-cell">
                      {group.productCount} {group.productCount === 1 ? "product" : "products"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-card bg-surface-container-lowest px-6 py-16 text-center">
          <SlidersHorizontal aria-hidden="true" className="size-8 text-on-surface-variant" />
          <p className="font-display text-headline-md text-on-surface">{q ? "No groups match that" : "No modifier groups yet"}</p>
          <p className="max-w-md text-body-md text-on-surface-variant">
            {q ? "Try a different search." : "A group is a set of choices like sauces or extras. Build one here, then add it to products from each product's page."}
          </p>
          {q ? (
            <Link href="/dashboard/modifiers" className="text-label-bold text-primary hover:underline">Clear search</Link>
          ) : null}
        </div>
      )}
    </div>
  );
}
