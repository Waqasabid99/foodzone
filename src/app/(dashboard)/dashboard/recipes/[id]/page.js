import Link from "next/link";
import { nullIfMissing } from "@/lib/api/errors";
import { notFound, redirect } from "next/navigation";
import { Factory, Pencil } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import ActionButton from "@/components/dashboard/inventory/ActionButton";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getSiteIdentity } from "@/server/content/site";
import { userNames } from "@/server/content/inventory-admin";
import { recipesUsing, versionsOf } from "@/server/content/production-admin";
import { getRecipe } from "@/server/services/recipe.service";
import { costRecipe } from "@/server/services/recipe-cost.service";
import { formatQuantity } from "@/lib/inventory";
import { recipeSaveMode } from "@/lib/production";
import { hasPermission } from "@/lib/dashboard-nav";
import { formatMoney } from "@/lib/format";
import { loginHref } from "@/lib/redirects";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recipe — FoodZone", robots: { index: false, follow: false } };

const when = (date) => new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const REASONS = {
  NO_COST_ON_ITEM: "has no cost yet — it has never been received or given an opening cost",
  SUB_RECIPE_COSTS_NOTHING: "costs nothing — its own ingredients have no cost",
  UNRESOLVED_SUB_RECIPE: "could not be costed",
};

export default async function RecipePage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/recipes/${id}`));
  if (!hasPermission(grantedPermissionKeys(principal), "recipes.read")) redirect("/dashboard");

  const includeCost = can(principal, "recipes.view_cost");
  const raw = await nullIfMissing(getRecipe(id, { includeCost }));
  if (!raw) notFound();
  const recipe = serialize(raw);

  const [versions, usedBy, costed, { currency }] = await Promise.all([
    versionsOf(recipe),
    recipesUsing(id),
    includeCost ? costRecipe({ recipeId: id }).then(serialize) : null,
    getSiteIdentity(),
  ]);
  const names = await userNames([recipe.createdById, ...versions.map((row) => row.createdById)]);

  const canEdit = can(principal, "recipes.update");
  const canDelete = can(principal, "recipes.delete") && !recipe.usage.productionOrders && !recipe.usage.usedAsSubRecipe;
  const planScope = branchScope(principal, "production_orders.create");
  const canPlan = Boolean(recipe.outputItemId) && recipe.isActive && (planScope.all || planScope.ids.length > 0);
  const saveMode = recipeSaveMode(recipe);
  const qty = (value, unit) => formatQuantity(value, { precision: unit?.precision ?? 3, unit: unit?.code });

  const makes = recipe.variant
    ? recipe.variant.name && recipe.variant.name !== "Regular"
      ? `${recipe.variant.product.name} — ${recipe.variant.name}`
      : recipe.variant.product.name
    : recipe.outputItem?.name;

  const costByIngredient = new Map((costed?.ingredients ?? []).map((line) => [line.itemId ?? line.subRecipeId, line]));
  const price = recipe.variant?.price != null ? Number(recipe.variant.price) : null;
  const unitCost = costed ? Number(costed.unitCost) : null;
  const foodCost = price && unitCost != null && price > 0 ? Math.round((unitCost / price) * 1000) / 10 : null;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title={recipe.name}
        description={`Makes ${qty(recipe.yieldQuantity, recipe.yieldUom)} of ${makes}${recipe.outputItemId ? " — made in batches and kept in stock" : " — made to order; its ingredients come off the shelf when it sells"}.`}
        back={{ href: `/dashboard/recipes${recipe.outputItemId ? "?view=STOCK" : ""}`, label: "Recipes" }}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Chip>Version {recipe.version}</Chip>
            {recipe.isActive ? <Chip tone="bg-success-container text-on-success-container">In use</Chip> : <Chip>Old version</Chip>}
            {canEdit ? (
              <Link href={`/dashboard/recipes/${id}/edit`} className="inline-flex items-center gap-2 rounded-field bg-surface-container-high px-4 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                <Pencil aria-hidden="true" className="size-4" />
                {saveMode === "revise" ? "Make a new version" : "Edit"}
              </Link>
            ) : null}
            {canPlan ? (
              <Link href={`/dashboard/production/new?recipe=${id}`} className="inline-flex items-center gap-2 rounded-field bg-primary-container px-4 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                <Factory aria-hidden="true" className="size-4" />
                Plan a batch
              </Link>
            ) : null}
          </div>
        }
      />

      {!recipe.isActive ? (
        <p role="status" className="rounded-card bg-warning-container px-5 py-3 text-body-md text-on-warning-container">
          This is an old version, kept as the record of what was made with it. {versions.find((row) => row.isActive) ? (
            <Link href={`/dashboard/recipes/${versions.find((row) => row.isActive).id}`} className="font-bold underline">See the version in use</Link>
          ) : "No version of this recipe is in use."}
        </p>
      ) : null}

      <Section title="Ingredients" description={`For one batch of ${qty(recipe.yieldQuantity, recipe.yieldUom)}.`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-body-md">
            <caption className="sr-only">Ingredients</caption>
            <thead>
              <tr className="border-b border-outline-variant text-label-bold text-on-surface-variant">
                <th scope="col" className="py-2 pr-4 font-normal">Ingredient</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">Amount</th>
                <th scope="col" className="hidden py-2 pr-4 text-right font-normal sm:table-cell">Waste</th>
                {includeCost ? <th scope="col" className="py-2 text-right font-normal">Cost</th> : null}
              </tr>
            </thead>
            <tbody>
              {recipe.ingredients.map((line) => {
                const cost = costByIngredient.get(line.itemId ?? line.subRecipeId);
                return (
                  <tr key={line.id} className="border-b border-outline-variant/60 align-top last:border-0">
                    <td className="py-2 pr-4">
                      {line.subRecipe ? (
                        <Link href={`/dashboard/recipes/${line.subRecipe.id}`} className="text-on-surface hover:underline">{line.subRecipe.name}</Link>
                      ) : (
                        <Link href={`/dashboard/inventory-items/${line.item.id}`} className="text-on-surface hover:underline">{line.item.name}</Link>
                      )}
                      <span className="block text-on-surface-variant">
                        {[line.subRecipe ? "Made as part of this recipe" : null, line.isOptional ? "Optional" : null, line.note ? `“${line.note}”` : null].filter(Boolean).join(" · ")}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-on-surface">{qty(line.quantity, line.uom)}</td>
                    <td className="hidden py-2 pr-4 text-right tabular-nums text-on-surface-variant sm:table-cell">{Number(line.wastagePercent) ? `${Number(line.wastagePercent)}%` : "—"}</td>
                    {includeCost ? (
                      <td className="py-2 text-right tabular-nums text-on-surface">
                        {cost ? formatMoney(cost.totalCost, currency) : "—"}
                        {cost && line.isOptional ? <span className="block text-on-surface-variant">not counted</span> : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {includeCost && costed ? (
        <Section title="What it costs" description="At today's ingredient costs. Optional ingredients are left out.">
          <dl className="grid gap-4 sm:grid-cols-4">
            <Figure label="Ingredients" value={formatMoney(costed.materialCost, currency)} />
            <Figure label="Labour and overhead" value={formatMoney(Number(costed.laborCost ?? 0) + Number(costed.overheadCost ?? 0), currency)} />
            <Figure label="One batch" value={formatMoney(costed.totalCost, currency)} />
            <Figure label={`Per ${recipe.yieldUom.code}`} value={formatMoney(costed.unitCost, currency)} strong />
          </dl>
          {price != null ? (
            <p className="text-body-md text-on-surface">
              Sells for {formatMoney(price, currency)} — food cost{" "}
              <span className={`text-label-bold ${foodCost != null && foodCost > 35 ? "text-error" : ""}`}>{foodCost != null ? `${foodCost}%` : "unknown"}</span>
              {foodCost != null ? `, leaving ${formatMoney(price - unitCost, currency)} a plate.` : "."}
            </p>
          ) : null}
          {costed.missingCosts.length ? (
            <div role="status" className="rounded-field bg-warning-container px-4 py-3 text-body-md text-on-warning-container">
              <p className="text-label-bold">This cost is incomplete.</p>
              <ul className="mt-1 list-disc pl-5">
                {costed.missingCosts.map((gap, index) => (
                  <li key={index}>
                    {gap.name ?? "An ingredient"} {REASONS[gap.reason] ?? "has no cost"}
                    {gap.viaSubRecipe ? ` (inside ${gap.viaSubRecipe})` : ""}.
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-body-md text-on-surface-variant">
              {recipe.costUpdatedAt ? `Saved cost: ${formatMoney(recipe.computedUnitCost, currency)} per ${recipe.yieldUom.code}, ${when(recipe.costUpdatedAt)}.` : "No cost has been saved yet."}
              {recipe.variantId && recipe.isActive ? " The saved cost is what each sale of this dish is costed at." : ""}
            </p>
            <ActionButton endpoint={`/admin/recipes/${id}/recost`} success="Cost saved.">Save today&apos;s cost</ActionButton>
          </div>
        </Section>
      ) : null}

      {recipe.instructions || recipe.prepTimeMinutes || recipe.cookTimeMinutes ? (
        <Section title="Method">
          {recipe.prepTimeMinutes || recipe.cookTimeMinutes ? (
            <p className="text-body-md text-on-surface-variant">
              {[recipe.prepTimeMinutes ? `Prep ${recipe.prepTimeMinutes} min` : null, recipe.cookTimeMinutes ? `Cook ${recipe.cookTimeMinutes} min` : null].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          {recipe.instructions ? <p className="whitespace-pre-line text-body-md text-on-surface">{recipe.instructions}</p> : null}
        </Section>
      ) : null}

      <Section title="Versions" description="Each change to a recipe that has been made from is kept, so past batches still show what they were made from.">
        <ul className="flex flex-col gap-2">
          {versions.map((version) => (
            <li key={version.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low px-4 py-3">
              <p className="text-body-md">
                {version.id === id ? <span className="text-label-bold text-on-surface">Version {version.version} (this one)</span> : <Link href={`/dashboard/recipes/${version.id}`} className="text-label-bold text-on-surface hover:underline">Version {version.version}</Link>}
                <span className="block text-on-surface-variant">
                  {when(version.createdAt)}
                  {names[version.createdById] ? ` by ${names[version.createdById]}` : ""}
                  {` · ${version._count.ingredients} ingredients`}
                  {version._count.productionOrders ? ` · made ${version._count.productionOrders} ${version._count.productionOrders === 1 ? "time" : "times"}` : ""}
                </span>
              </p>
              {version.isActive ? (
                <Chip tone="bg-success-container text-on-success-container">In use</Chip>
              ) : canEdit ? (
                <ActionButton endpoint={`/admin/recipes/${version.id}/activate`} confirm={`Use version ${version.version} again? It replaces the version in use, everywhere.`} success={`Version ${version.version} is in use now.`}>
                  Use this version
                </ActionButton>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      {usedBy.length ? (
        <Section title="Used in" description="These recipes include this one, so a change here changes them too.">
          <ul className="flex flex-wrap gap-2">
            {usedBy.map((row) => (
              <li key={row.id}>
                <Link href={`/dashboard/recipes/${row.id}`} className="inline-flex rounded-field bg-surface-container-low px-3 py-2 text-label-bold text-on-surface hover:bg-surface-container">
                  {row.name} v{row.version}
                  {row.isActive ? "" : " (old)"}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {canDelete ? (
        <Section title="Delete" description="Only possible while nothing has been made from it and no other recipe uses it.">
          <ActionButton method="delete" endpoint={`/admin/recipes/${id}`} tone="danger" confirm={`Delete version ${recipe.version} of ${recipe.name}? This cannot be undone.`} success="Recipe deleted." redirectTo="/dashboard/recipes">
            Delete this version
          </ActionButton>
        </Section>
      ) : null}
    </div>
  );
}

function Figure({ label, value, strong = false }) {
  return (
    <div className="rounded-field bg-surface-container-low px-4 py-3">
      <dt className="text-label-bold font-normal text-on-surface-variant">{label}</dt>
      <dd className={`mt-1 tabular-nums ${strong ? "font-display text-headline-md text-on-surface" : "text-label-bold text-on-surface"}`}>{value}</dd>
    </div>
  );
}
