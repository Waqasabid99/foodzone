import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import RecipeForm from "@/components/dashboard/production/RecipeForm";
import { getAuthContext } from "@/lib/api/auth";
import { can } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { itemOptions, unitOptions } from "@/server/content/inventory-admin";
import { liveRecipeByOutput, recipeOptions, variantOptions } from "@/server/content/production-admin";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "New recipe — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewRecipePage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/recipes/new"));
  if (!can(principal, "recipes.create")) redirect("/dashboard/recipes");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const kind = one(params.kind) === "STOCK" ? "STOCK" : "DISH";

  const [units, items, recipes, variants, liveByOutput] = await Promise.all([
    unitOptions(),
    itemOptions(),
    recipeOptions(),
    variantOptions(),
    liveRecipeByOutput(),
  ]);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="New recipe"
        description="Write it for one batch. Every branch uses the same recipe, and a later change is kept as a new version."
        back={{ href: "/dashboard/recipes", label: "Recipes" }}
      />
      <RecipeForm
        mode="create"
        units={serialize(units)}
        items={serialize(items)}
        recipes={serialize(recipes)}
        variants={serialize(variants)}
        liveByOutput={liveByOutput}
        includeCost={can(principal, "recipes.view_cost")}
        defaultKind={kind}
        defaultOutputId={String(one(params.output) ?? "")}
      />
    </div>
  );
}
