import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import ProductDetailsForm from "@/components/dashboard/products/ProductDetailsForm";
import { getWorkspaceViewer } from "@/server/auth/workspace";
import { getSiteIdentity } from "@/server/content/site";
import { productFormOptions } from "@/server/content/product-admin";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";
import { getAuthContext } from "@/lib/api/auth";

export const metadata = { title: "New combo — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewComboPage() {
  const [viewer, principal, { currency }] = await Promise.all([
    getWorkspaceViewer(),
    getAuthContext(),
    getSiteIdentity(),
  ]);
  if (!viewer || !principal) redirect(loginHref("/dashboard/combos/new"));
  // A combo is created as a product and then given slots, so it needs both.
  const can = (key) => hasPermission(viewer.permissions, key);
  if (!can("combos.create") || !can("products.create")) redirect("/dashboard/combos");

  const options = await productFormOptions({ principal });
  if (!options.categories.length) redirect("/dashboard/categories/new");

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="New combo"
        description="Set its name and price first. Once it is saved, add the slots customers choose from."
        back={{ href: "/dashboard/combos", label: "Combos" }}
      />
      <ProductDetailsForm kind="combo" options={options} currency={currency} canUpload={can("media.upload")} />
    </div>
  );
}
