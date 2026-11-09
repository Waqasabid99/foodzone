import Link from "next/link";
import { redirect } from "next/navigation";
import { ImageOff, Plus, Sandwich, X } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ProductFilters from "@/components/dashboard/products/ProductFilters";
import ProductSaleChip from "@/components/dashboard/products/ProductSaleChip";
import { getWorkspaceViewer } from "@/server/auth/workspace";
import { getSiteIdentity } from "@/server/content/site";
import { listProducts, menuPlacements } from "@/server/services/product.service";
import { listCategories } from "@/server/services/category.service";
import { listStations } from "@/server/services/station.service";
import { serialize } from "@/lib/api/serialize";
import { flattenTree, toTree } from "@/lib/category-tree";
import { PRODUCT_STATUSES, productSaleState } from "@/lib/product-form";
import { hasPermission } from "@/lib/dashboard-nav";
import { formatMoney } from "@/lib/format";
import { loginHref } from "@/lib/redirects";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope } from "@/lib/api/permissions";
import StoredImage from "@/components/ui/StoredImage";

export const metadata = {
  title: "Products — FoodZone",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

/**
 * Every product, and whether each one can actually be bought.
 *
 * A table, unlike the branch and category screens: a menu runs to hundreds of
 * items, and the job here is scanning a column — which ones are drafts, which
 * are published but on no menu — which is what a table is for.
 */
export default async function ProductsPage({ searchParams }) {
  const [viewer, principal, { currency }] = await Promise.all([
    getWorkspaceViewer(),
    getAuthContext(),
    getSiteIdentity(),
  ]);
  if (!viewer || !principal) redirect(loginHref("/dashboard/products"));
  if (!hasPermission(viewer.permissions, "products.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const q = one(params.q)?.trim() ?? "";
  const category = one(params.category) ?? "";
  const status = PRODUCT_STATUSES.some((option) => option.value === one(params.status)) ? one(params.status) : "all";
  const cursor = one(params.cursor) || undefined;

  const [categoryRows, stationRows] = await Promise.all([listCategories(), listStations()]);
  // Reached from the Stations page's product counts.
  const station = stationRows.find((row) => row.id === one(params.station)) ?? null;
  const categoryOptions = flattenTree(toTree(categoryRows)).map((row) => ({
    value: row.id,
    label: `${"— ".repeat(row.depth - 1)}${row.name}`,
  }));
  const categoryId = categoryRows.some((row) => row.id === category) ? category : "";

  const page = await listProducts({
    ...(q ? { search: q } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(station ? { stationId: station.id } : {}),
    ...(status === "published" ? { isActive: true } : {}),
    ...(status === "draft" ? { isActive: false } : {}),
    ...(status === "deleted" ? { onlyDeleted: true } : {}),
    scope: branchScope(principal, "products.read"),
    limit: PAGE_SIZE,
    cursor,
  });
  const placements = await menuPlacements(page.items.map((product) => product.id));
  const products = serialize(page.items);

  const canCreate = hasPermission(viewer.permissions, "products.create");
  const filtered = Boolean(q || categoryId || station) || status !== "all";

  const href = (extra = {}) => {
    const search = new URLSearchParams();
    if (q) search.set("q", q);
    if (categoryId) search.set("category", categoryId);
    if (status !== "all") search.set("status", status);
    if (station) search.set("station", station.id);
    // A null value removes a filter: `href({ station: null })` clears it.
    for (const [key, value] of Object.entries(extra)) {
      if (value) search.set(key, value);
      else search.delete(key);
    }
    const query = search.toString();
    return query ? `/dashboard/products?${query}` : "/dashboard/products";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Products"
        description="Everything that can go on a menu, and whether customers can buy it yet."
        actions={
          canCreate ? (
            <Link
              href="/dashboard/products/new"
              className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-3 font-display text-label-bold uppercase tracking-wide text-on-primary-container transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Plus aria-hidden="true" className="size-4" />
              New product
            </Link>
          ) : null
        }
      />

      <ProductFilters q={q} category={categoryId} status={status} station={station?.id ?? ""} categories={categoryOptions} />

      {station ? (
        <p className="flex flex-wrap items-center gap-2 text-body-md text-on-surface">
          Sent to the <span className="text-label-bold">{station.name}</span> station
          <Link
            href={href({ station: null })}
            className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2.5 py-1 text-label-bold text-on-surface hover:bg-surface-container-highest"
          >
            <X aria-hidden="true" className="size-3.5" />
            Clear
          </Link>
        </p>
      ) : null}

      {products.length ? (
        <div className="overflow-x-auto rounded-card bg-surface-container-lowest">
          <table className="w-full text-left text-body-md">
            <caption className="sr-only">Products</caption>
            <thead>
              <tr className="border-b border-outline-variant text-label-bold text-on-surface-variant">
                <th scope="col" className="px-4 py-3 font-normal">Product</th>
                <th scope="col" className="hidden px-4 py-3 font-normal md:table-cell">Category</th>
                <th scope="col" className="px-4 py-3 text-right font-normal">Price</th>
                <th scope="col" className="hidden px-4 py-3 font-normal sm:table-cell">Status</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => {
                const state = productSaleState(product, placements.get(product.id) ?? []);
                const sizes = product.variants.length;
                return (
                  <tr key={product.id} className="border-b border-outline-variant/60 last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-field bg-surface-container-low">
                          {product.imageUrl ? (
                             
                            <StoredImage src={product.imageUrl} className="size-full object-cover" />
                          ) : (
                            <ImageOff aria-hidden="true" className="size-4 text-on-surface-variant" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <Link
                            href={product.type === "COMBO" ? `/dashboard/combos/${product.id}` : `/dashboard/products/${product.id}`}
                            className="text-label-bold text-on-surface hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          >
                            {product.name}
                          </Link>
                          <p className="text-on-surface-variant md:hidden">{product.category?.name}</p>
                          <div className="mt-1 sm:hidden">
                            <ProductSaleChip state={state} />
                          </div>
                          {product.type === "COMBO" ? (
                            <p className="text-label-bold font-normal text-on-surface-variant">Combo</p>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 text-on-surface-variant md:table-cell">
                      {product.category?.name}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-on-surface">
                      {product.priceFrom === null ? (
                        <span className="text-on-surface-variant">No active size</span>
                      ) : (
                        <>
                          {sizes > 1 ? <span className="text-on-surface-variant">From </span> : null}
                          {formatMoney(product.priceFrom, currency)}
                        </>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <ProductSaleChip state={state} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-card bg-surface-container-lowest px-6 py-16 text-center">
          <Sandwich aria-hidden="true" className="size-8 text-on-surface-variant" />
          <p className="font-display text-headline-md text-on-surface">
            {filtered ? "No products match that" : "No products yet"}
          </p>
          <p className="max-w-md text-body-md text-on-surface-variant">
            {filtered
              ? "Try a different search, or clear the filters."
              : categoryRows.length
                ? "Add what you sell. Each product starts as a draft, so nothing reaches customers until it is published and placed on a menu."
                : "Every product belongs to a category, so create a category first."}
          </p>
          {filtered ? (
            <Link href="/dashboard/products" className="text-label-bold text-primary hover:underline">
              Clear filters
            </Link>
          ) : categoryRows.length === 0 ? (
            <Link href="/dashboard/categories/new" className="text-label-bold text-primary hover:underline">
              Create a category
            </Link>
          ) : canCreate ? (
            <Link
              href="/dashboard/products/new"
              className="mt-2 inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-3 font-display text-label-bold uppercase tracking-wide text-on-primary-container"
            >
              <Plus aria-hidden="true" className="size-4" />
              Create the first product
            </Link>
          ) : null}
        </div>
      )}

      <div className="flex flex-wrap justify-center gap-4">
        {cursor ? (
          <Link href={href()} className="text-label-bold text-primary hover:underline">
            Back to the first page
          </Link>
        ) : null}
        {page.nextCursor ? (
          <Link
            href={href({ cursor: page.nextCursor })}
            className="rounded-field bg-surface-container-high px-6 py-3 text-label-bold text-on-surface hover:bg-surface-container-highest"
          >
            Next page
          </Link>
        ) : null}
      </div>
    </div>
  );
}
