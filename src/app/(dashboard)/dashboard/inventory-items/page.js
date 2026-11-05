import Link from "next/link";
import { redirect } from "next/navigation";
import { FolderTree, Package, Plus, Ruler } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys, holdsCompanyWide } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { prisma } from "@/lib/prisma";
import { getSiteIdentity } from "@/server/content/site";
import { categoryOptions } from "@/server/content/inventory-admin";
import { listItems } from "@/server/services/inventory-item.service";
import { ITEM_TYPES, formatQuantity } from "@/lib/inventory";
import { hasPermission } from "@/lib/dashboard-nav";
import { formatMoney } from "@/lib/format";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Stock items — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const TYPE_LABELS = Object.fromEntries(ITEM_TYPES.map((type) => [type.value, type.label]));

/**
 * Everything the restaurant keeps on a shelf.
 *
 * The list is company-wide — one catalogue of ingredients — but the on-hand
 * column is the viewer's own branches only, so a manager sees their store
 * room rather than the chain's.
 */
export default async function InventoryItemsPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/inventory-items"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "inventory_items.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const q = one(params.q)?.trim() ?? "";
  const type = ITEM_TYPES.some((option) => option.value === one(params.type)) ? one(params.type) : "";
  const show = ["inactive", "all"].includes(one(params.show)) ? one(params.show) : "active";
  const low = one(params.low) === "1";
  const cursor = one(params.cursor) || undefined;

  const categories = await categoryOptions();
  const category = categories.some((option) => option.id === one(params.category)) ? one(params.category) : "";

  const [{ currency }, page, unitCount] = await Promise.all([
    getSiteIdentity(),
    listItems({
      ...(q ? { search: q } : {}),
      ...(type ? { type } : {}),
      ...(category ? { categoryId: category } : {}),
      ...(show === "all" ? {} : { isActive: show === "active" }),
      lowStock: low,
      scope: branchScope(principal, "inventory_items.read"),
      limit: PAGE_SIZE,
      cursor,
    }).catch((error) => {
      // A cursor from a list that has since changed is not worth an error page.
      if (cursor) return listItems({ limit: PAGE_SIZE, scope: branchScope(principal, "inventory_items.read") });
      throw error;
    }),
    prisma.unitOfMeasure.count({ where: { isActive: true } }),
  ]);

  const items = serialize(page.items);
  const canCreate = holdsCompanyWide(principal, "inventory_items.create");
  const showCost = hasPermission(permissions, "stock.view_valuation");
  const filtered = Boolean(q || type || category || low || show !== "active");

  const href = (extra = {}) => {
    const search = new URLSearchParams();
    const values = { q, type, category, show: show === "active" ? "" : show, low: low ? "1" : "", ...extra };
    for (const [key, value] of Object.entries(values)) if (value) search.set(key, String(value));
    const query = search.toString();
    return query ? `/dashboard/inventory-items?${query}` : "/dashboard/inventory-items";
  };

  const secondary =
    "inline-flex items-center gap-2 rounded-field border border-outline px-4 py-2.5 text-label-bold text-on-surface hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Stock items"
        description="Everything kept on a shelf — ingredients, packaging, supplies. Not the menu: a burger is a product, the bun and the patty are items."
        actions={
          <>
            {hasPermission(permissions, "units.read") ? (
              <Link href="/dashboard/inventory-items/units" className={secondary}>
                <Ruler aria-hidden="true" className="size-4" />
                Units
              </Link>
            ) : null}
            {hasPermission(permissions, "inventory_categories.read") ? (
              <Link href="/dashboard/inventory-items/categories" className={secondary}>
                <FolderTree aria-hidden="true" className="size-4" />
                Categories
              </Link>
            ) : null}
            {canCreate && unitCount ? (
              <Link href="/dashboard/inventory-items/new" className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                <Plus aria-hidden="true" className="size-4" />
                New item
              </Link>
            ) : null}
          </>
        }
      />

      {canCreate && !unitCount ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-secondary-container px-5 py-4 text-on-secondary-container">
          <p className="text-body-md">Every item is counted in a unit — kilograms, litres, pieces — so add those first.</p>
          <Link href="/dashboard/inventory-items/units" className="rounded-field bg-primary-container px-4 py-2 text-label-bold text-on-primary-container">Set up units</Link>
        </div>
      ) : null}

      <ListFilters
        id="items"
        fields={[
          { type: "search", name: "q", label: "Search", value: q, placeholder: "Name, SKU or barcode" },
          { type: "select", name: "type", label: "Kind", value: type, options: [{ value: "", label: "Every kind" }, ...ITEM_TYPES] },
          ...(categories.length
            ? [{ type: "select", name: "category", label: "Category", value: category, options: [{ value: "", label: "Every category" }, ...categories.map((option) => ({ value: option.id, label: option.name }))] }]
            : []),
          {
            type: "select",
            name: "show",
            label: "Show",
            value: show === "active" ? "" : show,
            options: [
              { value: "", label: "In use" },
              { value: "inactive", label: "Switched off" },
              { value: "all", label: "Everything" },
            ],
          },
          { type: "checkbox", name: "low", label: "Low stock only", value: low },
        ]}
      />

      {items.length ? (
        <>
          <div className="overflow-x-auto rounded-card bg-surface-container-lowest">
            <table className="w-full text-left text-body-md">
              <caption className="sr-only">Stock items</caption>
              <thead>
                <tr className="border-b border-outline-variant text-label-bold text-on-surface-variant">
                  <th scope="col" className="px-4 py-3 font-normal">Item</th>
                  <th scope="col" className="hidden px-4 py-3 font-normal md:table-cell">Kind</th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">On hand</th>
                  <th scope="col" className="hidden px-4 py-3 text-right font-normal sm:table-cell">Reorder at</th>
                  {showCost ? <th scope="col" className="hidden px-4 py-3 text-right font-normal lg:table-cell">Average cost</th> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className={`border-b border-outline-variant/60 last:border-0 ${item.isActive ? "" : "opacity-75"}`}>
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/inventory-items/${item.id}`} className="text-label-bold text-on-surface hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                        {item.name}
                      </Link>
                      <p className="text-on-surface-variant">
                        <span className="font-mono">{item.sku}</span>
                        {item.category ? ` · ${item.category.name}` : ""}
                        {!item.isActive ? " · switched off" : ""}
                      </p>
                    </td>
                    <td className="hidden px-4 py-3 text-on-surface-variant md:table-cell">{TYPE_LABELS[item.type] ?? item.type}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="tabular-nums text-on-surface">{formatQuantity(item.onHand, { precision: item.uom.precision, unit: item.uom.code })}</span>
                      {item.isLow ? (
                        <span className="mt-1 flex justify-end">
                          <Chip tone="bg-warning-container text-on-warning-container">Low</Chip>
                        </span>
                      ) : null}
                    </td>
                    <td className="hidden px-4 py-3 text-right tabular-nums text-on-surface-variant sm:table-cell">
                      {item.reorderLevel == null ? "—" : formatQuantity(item.reorderLevel, { precision: item.uom.precision, unit: item.uom.code })}
                    </td>
                    {showCost ? (
                      <td className="hidden px-4 py-3 text-right tabular-nums text-on-surface-variant lg:table-cell">
                        {Number(item.averageCost) ? `${formatMoney(item.averageCost, currency)} / ${item.uom.code}` : "—"}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cursor || page.nextCursor ? (
            <div className="flex flex-wrap gap-2">
              {cursor ? (
                <Link href={href()} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">First page</Link>
              ) : null}
              {page.nextCursor ? (
                <Link href={href({ cursor: page.nextCursor })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">Next page</Link>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState
          icon={Package}
          title={filtered ? "No items match that" : "No stock items yet"}
          action={filtered ? { href: "/dashboard/inventory-items", label: "Clear filters" } : canCreate && unitCount ? { href: "/dashboard/inventory-items/new", label: "Add the first item" } : null}
        >
          {filtered
            ? "Try a different search or filter."
            : "Add what the kitchen buys and uses. Stock then moves with deliveries, sales, waste and counts."}
        </EmptyState>
      )}
    </div>
  );
}
