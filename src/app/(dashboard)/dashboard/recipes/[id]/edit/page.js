import { notFound, redirect } from "next/navigation";
import { nullIfMissing } from "@/lib/api/errors";
import PageHeader from "@/components/dashboard/PageHeader";
import RecipeForm from "@/components/dashboard/production/RecipeForm";
import { getAuthContext } from "@/lib/api/auth";
import { can } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { itemOptions, unitOptions } from "@/server/content/inventory-admin";
import { recipeOptions } from "@/server/content/production-admin";
import { getRecipe } from "@/server/services/recipe.service";
import { recipeSaveMode } from "@/lib/production";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Edit recipe — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function EditRecipePage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/recipes/${id}/edit`));
  if (!can(principal, "recipes.update")) redirect(`/dashboard/recipes/${id}`);

  const includeCost = can(principal, "recipes.view_cost");
  const raw = await nullIfMissing(getRecipe(id, { includeCost }));
  if (!raw) notFound();
  const recipe = serialize(raw);
  const mode = recipeSaveMode(recipe);

  const [units, activeItems, liveRecipes] = await Promise.all([unitOptions(), itemOptions({ includeInactive: true }), recipeOptions()]);

  // What the recipe already uses stays choosable even if it has since been
  // switched off or superseded, so opening the form does not blank a line.
  const usedItemIds = new Set(recipe.ingredients.map((line) => line.itemId).filter(Boolean));
  const items = activeItems.filter((item) => item.isActive || usedItemIds.has(item.id));
  const usedSubIds = recipe.ingredients.map((line) => line.subRecipeId).filter(Boolean);
  const missing = usedSubIds.filter((subId) => !liveRecipes.some((row) => row.id === subId));
  const olderSubs = missing.length ? (await Promise.all(missing.map((subId) => getRecipe(subId).catch(() => null)))).filter(Boolean) : [];
  const recipes = [
    ...liveRecipes,
    ...olderSubs.map((sub) => ({ id: sub.id, name: `${sub.name} (v${sub.version}, old)`, version: sub.version, variantId: sub.variantId, outputItemId: sub.outputItemId, yieldUomId: sub.yieldUomId, yieldUom: sub.yieldUom })),
  ];

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={mode === "revise" ? `New version of ${recipe.name}` : `Edit ${recipe.name}`}
        description={
          mode === "revise"
            ? `Version ${recipe.version} has been made ${recipe.usage.productionOrders} ${recipe.usage.productionOrders === 1 ? "time" : "times"}, so it is kept as the record of those runs. Your changes become version ${recipe.version + 1}.`
            : "Nothing has been made from this version yet, so it is changed in place."
        }
        back={{ href: `/dashboard/recipes/${id}`, label: recipe.name }}
      />
      <RecipeForm mode={mode} recipe={recipe} units={serialize(units)} items={serialize(items)} recipes={serialize(recipes)} includeCost={includeCost} />
    </div>
  );
}
