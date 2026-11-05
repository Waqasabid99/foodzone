import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import CategoryForm from "@/components/dashboard/categories/CategoryForm";
import { getWorkspaceViewer } from "@/server/auth/workspace";
import { listCategories } from "@/server/services/category.service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = {
  title: "New category — FoodZone",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function NewCategoryPage({ searchParams }) {
  const viewer = await getWorkspaceViewer();
  if (!viewer) redirect(loginHref("/dashboard/categories/new"));
  if (!hasPermission(viewer.permissions, "categories.create")) redirect("/dashboard/categories");

  const [{ parent }, categories] = await Promise.all([searchParams, listCategories()]);
  const requested = Array.isArray(parent) ? parent[0] : parent;
  // Only pre-select a parent that exists; a stale link falls back to top level.
  const parentRow = categories.find((row) => row.id === requested) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={parentRow ? `New category in ${parentRow.name}` : "New category"}
        back={{ href: "/dashboard/categories", label: "Categories" }}
      />
      <CategoryForm
        categories={categories}
        defaultParentId={parentRow?.id ?? ""}
        canUpload={hasPermission(viewer.permissions, "media.upload")}
      />
    </div>
  );
}
