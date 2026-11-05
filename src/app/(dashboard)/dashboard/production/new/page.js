import Link from "next/link";
import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import ProductionPlanForm from "@/components/dashboard/production/ProductionPlanForm";
import { getAuthContext } from "@/lib/api/auth";
import { can } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { actionableLocations } from "@/server/content/inventory-admin";
import { producibleRecipes } from "@/server/content/production-admin";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Plan a batch — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewProductionPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/production/new"));

  const locations = await actionableLocations(principal, "production_orders.create");
  if (!locations.length) redirect("/dashboard/production");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const recipes = await producibleRecipes();
  const defaultRecipeId = recipes.some((row) => row.id === one(params.recipe)) ? one(params.recipe) : "";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Plan a batch"
        description="Nothing leaves the shelf yet. The batch's page then shows what it needs against what is there, and the ingredients are taken out when it starts."
        back={{ href: "/dashboard/production", label: "Production" }}
      />
      {recipes.length ? (
        <ProductionPlanForm recipes={serialize(recipes)} locations={serialize(locations)} defaultRecipeId={defaultRecipeId} />
      ) : (
        <p className="rounded-card bg-surface-container-lowest px-5 py-4 text-body-md text-on-surface-variant">
          There is no recipe for a prep item yet.{" "}
          {can(principal, "recipes.create") ? (
            <Link href="/dashboard/recipes/new?kind=STOCK" className="text-label-bold text-primary hover:underline">Write one</Link>
          ) : (
            "Ask a head chef to write one"
          )}{" "}
          — a sauce, a dough — and it can be made in batches here.
        </p>
      )}
    </div>
  );
}
