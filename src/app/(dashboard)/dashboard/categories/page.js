import Link from "next/link";
import { redirect } from "next/navigation";
import { FolderTree, Plus } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import CategoryTree from "@/components/dashboard/categories/CategoryTree";
import { getWorkspaceViewer } from "@/server/auth/workspace";
import { listCategories } from "@/server/services/category.service";
import { toTree } from "@/lib/category-tree";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = {
  title: "Categories — FoodZone",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The menu's structure: every category, nested, in the order customers see.
 *
 * The whole tree is loaded at once, with no search or paging. A restaurant has
 * tens of categories, not thousands, and a tree is only readable whole — a
 * paged or filtered tree shows children without their parents.
 */
export default async function CategoriesPage() {
  const viewer = await getWorkspaceViewer();
  if (!viewer) redirect(loginHref("/dashboard/categories"));
  if (!hasPermission(viewer.permissions, "categories.read")) redirect("/dashboard");

  const rows = await listCategories({ includeCounts: true });
  const tree = toTree(rows);

  const canCreate = hasPermission(viewer.permissions, "categories.create");
  const canUpdate = hasPermission(viewer.permissions, "categories.update");
  const hidden = rows.filter((row) => !row.isActive).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Categories"
        description={
          rows.length
            ? `${rows.length} ${rows.length === 1 ? "category" : "categories"}${hidden ? `, ${hidden} hidden` : ""}. The order here is the order on the menu.`
            : "How the menu is grouped."
        }
        actions={
          canCreate ? (
            <Link
              href="/dashboard/categories/new"
              className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-3 font-display text-label-bold uppercase tracking-wide text-on-primary-container transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Plus aria-hidden="true" className="size-4" />
              New category
            </Link>
          ) : null
        }
      />

      {tree.length ? (
        <CategoryTree tree={tree} canCreate={canCreate} canUpdate={canUpdate} />
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-card bg-surface-container-lowest px-6 py-16 text-center">
          <FolderTree aria-hidden="true" className="size-8 text-on-surface-variant" />
          <p className="font-display text-headline-md text-on-surface">No categories yet</p>
          <p className="max-w-md text-body-md text-on-surface-variant">
            Every product belongs to a category, so this comes first — start with the headings you want on the
            menu, like Burgers, Sides and Drinks.
          </p>
          {canCreate ? (
            <Link
              href="/dashboard/categories/new"
              className="mt-2 inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-3 font-display text-label-bold uppercase tracking-wide text-on-primary-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Plus aria-hidden="true" className="size-4" />
              Create the first category
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}
