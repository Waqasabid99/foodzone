import Link from "next/link";
import { redirect } from "next/navigation";
import { NotebookPen, Plus } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import ActionButton from "@/components/dashboard/inventory/ActionButton";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getSiteIdentity } from "@/server/content/site";
import { listRecipes } from "@/server/services/recipe.service";
import { menuCostReport } from "@/server/services/recipe-cost.service";
import { formatQuantity } from "@/lib/inventory";
import { lastSeen } from "@/lib/customer-form";
import { hasPermission } from "@/lib/dashboard-nav";
import { formatMoney } from "@/lib/format";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Recipes — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;
const VIEWS = [
  { value: "DISH", label: "Dishes" },
  { value: "STOCK", label: "Prep items" },
  { value: "COST", label: "Food cost", cost: true },
];

/**
 * Every recipe the kitchen works from. Recipes are shared by all branches:
 * one burger, made one way everywhere.
 */
export default async function RecipesPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/recipes"));
  if (!hasPermission(grantedPermissionKeys(principal), "recipes.read")) redirect("/dashboard");

  const includeCost = can(principal, "recipes.view_cost");
  const canCreate = can(principal, "recipes.create");
  const views = VIEWS.filter((view) => !view.cost || includeCost);

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const view = views.some((entry) => entry.value === one(params.view)) ? one(params.view) : "DISH";
  const search = String(one(params.q) ?? "").trim().slice(0, 120);
  const old = one(params.old) === "1";
  const cursor = one(params.cursor) || undefined;

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { view, q: search, old: old ? "1" : "", ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    return `/dashboard/recipes?${query.toString()}`;
  };

  const { currency } = await getSiteIdentity();

  let page = null;
  let costs = null;
  if (view === "COST") {
    costs = serialize(await menuCostReport({ limit: 500 }));
  } else {
    const query = { output: view, ...(search ? { search } : {}), ...(old ? {} : { isActive: true }), includeCost, limit: PAGE_SIZE };
    page = await listRecipes({ ...query, cursor }).catch((error) => {
      if (cursor) return listRecipes(query);
      throw error;
    });
    page = { ...page, items: serialize(page.items) };
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Recipes"
        description="What goes into each dish and prep item, and how much. Recipes are shared by every branch, and each change is kept as a version."
        actions={
          canCreate ? (
            <Link href={`/dashboard/recipes/new${view === "STOCK" ? "?kind=STOCK" : ""}`} className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <Plus aria-hidden="true" className="size-4" />
              New recipe
            </Link>
          ) : null
        }
      />

      <nav className="flex flex-wrap gap-2" aria-label="Recipe views">
        {views.map((entry) => (
          <Link
            key={entry.value}
            href={href({ view: entry.value, cursor: "" })}
            aria-current={entry.value === view ? "page" : undefined}
            className={`rounded-field px-4 py-2.5 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${entry.value === view ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      {view === "COST" ? (
        <FoodCost rows={costs} currency={currency} />
      ) : (
        <>
          <ListFilters
            id="recipes"
            hidden={{ view }}
            fields={[
              { type: "search", name: "q", label: "Search", value: search, placeholder: "Recipe name" },
              { type: "checkbox", name: "old", label: "Include old versions", value: old },
            ]}
          />

          {page.items.length ? (
            <>
              <ul className="flex flex-col gap-3">
                {page.items.map((recipe) => {
                  const makes = recipe.variant
                    ? recipe.variant.name && recipe.variant.name !== "Regular"
                      ? `${recipe.variant.product.name} — ${recipe.variant.name}`
                      : recipe.variant.product.name
                    : recipe.outputItem?.name;
                  return (
                    <li key={recipe.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2">
                          <Link href={`/dashboard/recipes/${recipe.id}`} className="text-label-bold text-on-surface hover:underline">{recipe.name}</Link>
                          <Chip>v{recipe.version}</Chip>
                          {recipe.isActive ? null : <Chip>Old version</Chip>}
                        </p>
                        <p className="mt-1 text-body-md text-on-surface-variant">
                          Makes {formatQuantity(recipe.yieldQuantity, { precision: recipe.yieldUom.precision, unit: recipe.yieldUom.code })} of {makes}
                          {` · ${recipe.ingredientCount} ${recipe.ingredientCount === 1 ? "ingredient" : "ingredients"}`}
                          {recipe.runCount ? ` · made ${recipe.runCount} ${recipe.runCount === 1 ? "time" : "times"}` : ""}
                          {` · changed ${lastSeen(recipe.updatedAt).toLowerCase()}`}
                        </p>
                      </div>
                      {includeCost ? (
                        <p className="text-right text-body-md">
                          {recipe.computedUnitCost != null ? (
                            <>
                              <span className="block tabular-nums text-label-bold text-on-surface">{formatMoney(recipe.computedUnitCost, currency)}</span>
                              <span className="text-on-surface-variant">per {recipe.yieldUom.code}</span>
                            </>
                          ) : (
                            <span className="text-on-surface-variant">Not costed yet</span>
                          )}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {cursor || page.nextCursor ? (
                <div className="flex flex-wrap gap-2">
                  {cursor ? <Link href={href({ cursor: "" })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">First page</Link> : null}
                  {page.nextCursor ? <Link href={href({ cursor: page.nextCursor })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">Next page</Link> : null}
                </div>
              ) : null}
            </>
          ) : (
            <EmptyState
              icon={NotebookPen}
              title={search ? "No recipe by that name" : view === "STOCK" ? "No prep recipes yet" : "No dish recipes yet"}
              action={canCreate && !search ? { href: `/dashboard/recipes/new${view === "STOCK" ? "?kind=STOCK" : ""}`, label: "Write the first one" } : null}
            >
              {search
                ? "Try another name, or include old versions."
                : view === "STOCK"
                  ? "A prep recipe makes something the kitchen keeps in stock — a sauce, a dough — in batches."
                  : "A dish recipe says what comes off the shelf each time the dish is sold."}
            </EmptyState>
          )}
        </>
      )}
    </div>
  );
}

/** Dishes against their prices, worst food cost first. Unknown is shown as unknown, never as free. */
function FoodCost({ rows, currency }) {
  const costed = rows.filter((row) => row.isCosted);
  return (
    <section className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-headline-md text-on-surface">Food cost by dish</h2>
          <p className="mt-1 max-w-2xl text-body-md text-on-surface-variant">
            What each dish costs to make against what it sells for, at today&apos;s ingredient costs. Costs refresh when a recipe changes; recalculate after deliveries move prices.
          </p>
        </div>
        <ActionButton endpoint="/admin/recipes/recost" body={{ onlyActive: true }} success="Every recipe has been recosted.">
          Recalculate all
        </ActionButton>
      </div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-body-md">
            <caption className="sr-only">Food cost by dish, worst first</caption>
            <thead>
              <tr className="border-b border-outline-variant text-label-bold text-on-surface-variant">
                <th scope="col" className="py-2 pr-4 font-normal">Dish</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">Price</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">Cost</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">Food cost</th>
                <th scope="col" className="hidden py-2 text-right font-normal sm:table-cell">Margin</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.recipeId} className="border-b border-outline-variant/60 last:border-0">
                  <td className="py-2 pr-4">
                    <Link href={`/dashboard/recipes/${row.recipeId}`} className="text-on-surface hover:underline">
                      {row.product}
                      {row.variant && row.variant !== "Regular" ? ` — ${row.variant}` : ""}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{row.price != null ? formatMoney(row.price, currency) : "—"}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{row.isCosted ? formatMoney(row.unitCost, currency) : <span className="text-on-surface-variant">Not costed</span>}</td>
                  <td className={`py-2 pr-4 text-right tabular-nums text-label-bold ${row.foodCostPercent != null && row.foodCostPercent > 35 ? "text-error" : "text-on-surface"}`}>
                    {row.foodCostPercent != null ? `${row.foodCostPercent}%` : "—"}
                  </td>
                  <td className="hidden py-2 text-right tabular-nums sm:table-cell">{row.contributionMargin != null ? formatMoney(row.contributionMargin, currency) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-body-md text-on-surface-variant">No dish has a recipe yet.</p>
      )}
      {rows.length && costed.length < rows.length ? (
        <p className="text-body-md text-on-surface-variant">{rows.length - costed.length} of {rows.length} dishes have no cost yet — press Recalculate all.</p>
      ) : null}
      <p className="text-body-md text-on-surface-variant">Food cost above 35% is marked. Most kitchens aim for 28–35%.</p>
    </section>
  );
}
