import { notFound, redirect } from "next/navigation";
import { nullIfMissing } from "@/lib/api/errors";
import PageHeader from "@/components/dashboard/PageHeader";
import CategoryForm from "@/components/dashboard/categories/CategoryForm";
import { getWorkspaceViewer } from "@/server/auth/workspace";
import { getCategory, listCategories } from "@/server/services/category.service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = {
  title: "Edit category — FoodZone",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function EditCategoryPage({ params }) {
  const { id } = await params;
  const viewer = await getWorkspaceViewer();
  if (!viewer) redirect(loginHref(`/dashboard/categories/${id}/edit`));
  if (!hasPermission(viewer.permissions, "categories.update")) redirect("/dashboard/categories");

  const [category, categories] = await Promise.all([nullIfMissing(getCategory(id)), listCategories()]);
  // `getCategory` also matches a slug; the edit URL is only ever an id.
  if (!category || category.id !== id) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Edit ${category.name}`}
        description={`${category.productCount} ${category.productCount === 1 ? "product" : "products"} in this category.`}
        back={{ href: "/dashboard/categories", label: "Categories" }}
      />
      <CategoryForm
        category={category}
        categories={categories}
        canUpload={hasPermission(viewer.permissions, "media.upload")}
        canDelete={hasPermission(viewer.permissions, "categories.delete")}
      />
    </div>
  );
}
