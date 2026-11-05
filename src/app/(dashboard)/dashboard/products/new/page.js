import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import ProductDetailsForm from "@/components/dashboard/products/ProductDetailsForm";
import { getWorkspaceViewer } from "@/server/auth/workspace";
import { getSiteIdentity } from "@/server/content/site";
import { productFormOptions } from "@/server/content/product-admin";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";
import { getAuthContext } from "@/lib/api/auth";

export const metadata = {
  title: "New product — FoodZone",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const [viewer, principal, { currency }] = await Promise.all([
    getWorkspaceViewer(),
    getAuthContext(),
    getSiteIdentity(),
  ]);
  if (!viewer || !principal) redirect(loginHref("/dashboard/products/new"));
  if (!hasPermission(viewer.permissions, "products.create")) redirect("/dashboard/products");

  const options = await productFormOptions({ principal });
  // A product cannot be saved without a category; sending someone into a form
  // they can never submit would be worse than sending them to make one.
  if (!options.categories.length) redirect("/dashboard/categories/new");

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="New product"
        description="It is saved as a draft. Customers see it only once it is published and on a branch menu."
        back={{ href: "/dashboard/products", label: "Products" }}
      />
      <ProductDetailsForm
        options={options}
        currency={currency}
        canUpload={hasPermission(viewer.permissions, "media.upload")}
      />
    </div>
  );
}
