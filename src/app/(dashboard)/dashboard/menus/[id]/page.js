import { notFound, redirect } from "next/navigation";
import { Info } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import HealthNotice from "@/components/dashboard/HealthNotice";
import DeleteSection from "@/components/dashboard/DeleteSection";
import MenuStatusChip from "@/components/dashboard/menus/MenuStatusChip";
import MenuPublishButton from "@/components/dashboard/menus/MenuPublishButton";
import MenuForm from "@/components/dashboard/menus/MenuForm";
import MenuSectionsEditor from "@/components/dashboard/menus/MenuSectionsEditor";
import MenuItemsEditor from "@/components/dashboard/menus/MenuItemsEditor";
import CloneMenuForm from "@/components/dashboard/menus/CloneMenuForm";
import { getAuthContext } from "@/lib/api/auth";
import { can as canAt } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { prisma } from "@/lib/prisma";
import { menuWorkspace, scopedBranches } from "@/server/content/menu-admin";
import { listCategories } from "@/server/services/category.service";
import { flattenTree, toTree } from "@/lib/category-tree";
import { describeSchedule, menuHealth, menuTypeLabel } from "@/lib/menu-schedule";
import { loginHref } from "@/lib/redirects";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { id } = await params;
  // Only the name: whether the viewer may see the rest is decided by the page.
  const menu = await prisma.menu.findUnique({ where: { id }, select: { name: true } }).catch(() => null);
  return { title: menu ? `${menu.name} — Menus — FoodZone` : "Menu — FoodZone", robots: { index: false, follow: false } };
}

const EXPLAIN = {
  LIVE: "Customers ordering for this channel see this menu right now.",
  OFF: "Customers do not see it. Switch it on when it is ready.",
  ENDED: "Its last day has passed, so it no longer shows.",
  UPCOMING: "Its first day has not arrived yet.",
  OUT_OF_HOURS: "Switched on, but its days or times do not include right now.",
};

export default async function MenuPage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/menus/${id}`));

  const now = new Date();
  const data = await menuWorkspace(id, { now });
  if (!data) notFound();

  // Every permission is judged at this menu's branch. A manager of another
  // outlet holds `menus.read` too, just not here — and for them the menu does
  // not exist, rather than being a page they are bounced from.
  const branchId = data.menu.branchId;
  const can = (key) => canAt(principal, key, { branchId });
  if (!can("menus.read")) {
    if (canAt(principal, "menus.read")) notFound();
    redirect("/dashboard");
  }

  const permissions = {
    arrange: can("menus.update"),
    price: can("menu_items.update_price"),
    toggle: can("menu_items.toggle_availability"),
    // Adding searches the catalog, which is its own permission.
    add: can("menus.update") && canAt(principal, "products.read"),
    openProducts: canAt(principal, "products.read"),
  };

  const [cloneTargets, categoryRows] = await Promise.all([
    scopedBranches(principal, "menus.create"),
    permissions.add ? listCategories() : [],
  ]);

  const menu = serialize(data.menu);
  const items = serialize(data.items);
  const { branch, sections, live } = menu;
  const sectionProducts = {};
  for (const row of items) {
    if (row.sectionId) (sectionProducts[row.sectionId] ??= new Set()).add(row.productId);
  }
  const productCounts = Object.fromEntries(Object.entries(sectionProducts).map(([key, set]) => [key, set.size]));
  const productCount = new Set(items.map((row) => row.productId)).size;
  // Distinct products with nowhere to sit — what the storefront lumps under
  // "More". Counted per product, not per variant: three sizes of one pizza are
  // one thing a customer sees in the wrong place.
  const unsectioned = new Set(items.filter((row) => !row.sectionId).map((row) => row.productId)).size;
  const categories = flattenTree(toTree(categoryRows)).map((row) => ({ value: row.id, label: `${"— ".repeat(row.depth - 1)}${row.name}` }));

  const liveDetail =
    live.key === "OUTRANKED"
      ? `Switched on and scheduled, but “${live.by}” is more specific or is the fallback, so customers see that instead.`
      : EXPLAIN[live.key];
  const fallback =
    data.dineInFallback && live.key !== "LIVE"
      ? `When no ${menuTypeLabel(menu.type).toLowerCase()} menu is showing, those orders use the dine-in menu — right now “${data.dineInFallback.name}”.`
      : null;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={menu.name}
        description={`${branch.name} · ${menuTypeLabel(menu.type)}${menu.isDefault ? " · fallback" : ""}`}
        back={{ href: "/dashboard/menus", label: "Menus" }}
        actions={can("menus.publish") ? <MenuPublishButton menuId={menu.id} name={menu.name} isActive={menu.isActive} productCount={productCount} /> : null}
      />

      <section aria-label="Right now" className="flex flex-col gap-2 rounded-card bg-surface-container-lowest p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <MenuStatusChip live={live} />
          <span className="text-body-md text-on-surface-variant">{describeSchedule(menu, branch.timezone)}</span>
        </div>
        <p className="text-body-md text-on-surface">{liveDetail}</p>
        {!branch.isActive ? <p className="text-body-md text-error">{branch.name} is not trading, so none of its menus show.</p> : null}
        {fallback ? (
          <p className="flex items-start gap-2 text-body-md text-on-surface-variant">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {fallback}
          </p>
        ) : null}
        {!can("menus.publish") && !menu.isActive ? <p className="text-body-md text-on-surface-variant">Ask a manager to switch it on.</p> : null}
      </section>

      <HealthNotice issues={menuHealth({ menu, sections, items, now })} />

      {data.truncated ? (
        <p className="rounded-card bg-warning-container px-5 py-3 text-body-md text-on-warning-container">
          This menu has more than 5,000 size rows; only the first 5,000 are shown here.
        </p>
      ) : null}

      <MenuItemsEditor
        menuId={menu.id}
        items={items}
        sections={sections}
        branch={{ timezone: branch.timezone }}
        currency={branch.currency}
        now={now.toISOString()}
        can={permissions}
        categories={categories}
      />

      <MenuSectionsEditor
        unsectioned={unsectioned} menuId={menu.id} sections={sections} productCounts={productCounts} canEdit={permissions.arrange} />

      <MenuForm key={menu.updatedAt} menu={menu} readOnly={!permissions.arrange} />

      {cloneTargets.length ? <CloneMenuForm menu={menu} branches={cloneTargets} /> : null}

      {can("menus.delete") ? (
        <DeleteSection
          title="Delete menu"
          description={
            menu.qrCodeCount
              ? `${menu.qrCodeCount} printed QR ${menu.qrCodeCount === 1 ? "code points" : "codes point"} at this menu, so it cannot be deleted until they point elsewhere. To stop using it, switch it off.`
              : "Its sections and product placements are deleted with it; the products themselves are not. To stop using it for now, switch it off instead."
          }
          endpoint={`/admin/menus/${menu.id}`}
          confirm={`Delete "${menu.name}"? This cannot be undone.`}
          redirectTo="/dashboard/menus"
          success="Menu deleted."
        />
      ) : null}
    </div>
  );
}
