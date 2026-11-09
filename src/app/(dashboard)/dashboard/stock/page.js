import Link from "next/link";
import { redirect } from "next/navigation";
import { Boxes, MapPin } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import StatTile from "@/components/dashboard/StatTile";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import BatchActions from "@/components/dashboard/inventory/BatchActions";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getSiteIdentity } from "@/server/content/site";
import { categoryOptions, scopedBranches, scopedLocations, stockSummary } from "@/server/content/inventory-admin";
import { expiryReport, stockOnHand } from "@/server/services/stock.service";
import { expiryState, formatQuantity } from "@/lib/inventory";
import { hasPermission } from "@/lib/dashboard-nav";
import { formatMoney } from "@/lib/format";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Stock — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * What is on the shelves, where, right now.
 *
 * One row per item per location, because that is how stock physically is and
 * how the reorder level is judged. Below it, the batches about to go off —
 * the list a kitchen acts on every morning.
 */
export default async function StockPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/stock"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "stock.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const q = one(params.q)?.trim() ?? "";
  const low = one(params.low) === "1";
  const cursor = one(params.cursor) || undefined;

  const scope = branchScope(principal, "stock.read");
  const [branches, locations, categories] = await Promise.all([
    scopedBranches(principal, "stock.read"),
    scopedLocations(principal, "stock.read", { activeOnly: false }),
    categoryOptions(),
  ]);
  const branch = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : "";
  const location = locations.some((row) => row.id === one(params.location) && (!branch || row.branchId === branch)) ? one(params.location) : "";
  const category = categories.some((row) => row.id === one(params.category)) ? one(params.category) : "";

  const showCost = hasPermission(permissions, "stock.view_valuation");
  const showBatches = hasPermission(permissions, "stock_batches.read");

  const [{ currency }, summary, page, expiring] = await Promise.all([
    getSiteIdentity(),
    stockSummary(principal, { branchId: branch || null }),
    stockOnHand({
      ...(q ? { search: q } : {}),
      ...(branch ? { branchId: branch } : {}),
      ...(location ? { locationId: location } : {}),
      ...(category ? { categoryId: category } : {}),
      lowOnly: low,
      scope,
      limit: PAGE_SIZE,
      cursor,
    }).catch((error) => {
      if (cursor) return stockOnHand({ scope, limit: PAGE_SIZE });
      throw error;
    }),
    showBatches
      ? expiryReport({ withinDays: 7, ...(branch ? { branchId: branch } : {}), scope: branchScope(principal, "stock_batches.read") })
      : [],
  ]);

  const rows = serialize(page.items);
  /*
   * The "free" column appears only when something is actually promised.
   *
   * A branch with reservations switched off, or one whose orders are all made
   * and gone, would otherwise carry a column repeating "on hand" in different
   * words down every row — and a column that never says anything new teaches
   * people to stop reading the ones beside it.
   */
  const anyHeld = rows.some((row) => Number(row.reserved) > 0);
  const batches = serialize(expiring);
  const multiBranch = branches.length > 1;
  const filtered = Boolean(q || low || location || category || branch);
  const activeLocations = locations.filter((row) => row.isActive);

  const href = (extra = {}) => {
    const search = new URLSearchParams();
    const values = { q, branch, location, category, low: low ? "1" : "", ...extra };
    for (const [key, value] of Object.entries(values)) if (value) search.set(key, String(value));
    const query = search.toString();
    return query ? `/dashboard/stock?${query}` : "/dashboard/stock";
  };

  const locationOptions = multiBranch
    ? branches
        .filter((row) => !branch || row.id === branch)
        .map((row) => ({ group: row.name, options: locations.filter((loc) => loc.branchId === row.id).map((loc) => ({ value: loc.id, label: loc.name })) }))
        .filter((group) => group.options.length)
    : locations.map((loc) => ({ value: loc.id, label: loc.name }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Stock"
        description="What is on the shelves at each location, as the ledger has it. Deliveries, sales, waste, transfers and counts all move these numbers."
        actions={
          hasPermission(permissions, "stock_locations.read") ? (
            <Link href="/dashboard/stock/locations" className="inline-flex items-center gap-2 rounded-field border border-outline px-4 py-2.5 text-label-bold text-on-surface hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <MapPin aria-hidden="true" className="size-4" />
              Locations
            </Link>
          ) : null
        }
      />

      {!activeLocations.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-secondary-container px-5 py-4 text-on-secondary-container">
          <p className="max-w-2xl text-body-md">
            {multiBranch ? "Your branches have" : "This branch has"} no stock locations yet. Stock has to be somewhere — a store room, a fridge — and until there is one, sales cannot take ingredients out of stock.
          </p>
          {hasPermission(permissions, "stock_locations.manage") ? (
            <Link href="/dashboard/stock/locations" className="rounded-field bg-primary-container px-4 py-2 text-label-bold text-on-primary-container">Add a location</Link>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Items held" value={String(summary.levels)} note={branch ? "At this branch" : multiBranch ? "Across your branches" : "Across every location"} />
        <StatTile label="Low" value={String(summary.low)} note={summary.low ? "At or below reorder level" : "Nothing needs ordering"} />
        {showCost ? <StatTile label="Worth" value={formatMoney(summary.value, currency)} note="At average cost" /> : null}
        {showBatches ? (
          <StatTile label="Going off" value={String(batches.length)} note={batches.some((batch) => batch.isExpired) ? `${batches.filter((batch) => batch.isExpired).length} already expired` : "Within 7 days"} />
        ) : !showCost ? (
          <StatTile label="Below zero" value={String(summary.negative)} note={summary.negative ? "Count these" : "None"} />
        ) : null}
      </div>

      {summary.negative && (showCost || showBatches) ? (
        <p className="rounded-card bg-warning-container px-5 py-3 text-body-md text-on-warning-container">
          {summary.negative} {summary.negative === 1 ? "item is" : "items are"} below zero somewhere — more was used than the system knew about. A count puts that right.
        </p>
      ) : null}

      <ListFilters
        id="stock"
        fields={[
          { type: "search", name: "q", label: "Search", value: q, placeholder: "Item name or SKU" },
          ...(multiBranch ? [{ type: "select", name: "branch", label: "Branch", value: branch, options: [{ value: "", label: "All branches" }, ...branches.map((row) => ({ value: row.id, label: row.name }))] }] : []),
          ...(locations.length > 1 ? [{ type: "select", name: "location", label: "Location", value: location, options: [{ value: "", label: "Every location" }, ...locationOptions] }] : []),
          ...(categories.length ? [{ type: "select", name: "category", label: "Category", value: category, options: [{ value: "", label: "Every category" }, ...categories.map((row) => ({ value: row.id, label: row.name }))] }] : []),
          { type: "checkbox", name: "low", label: "Low only", value: low },
        ]}
      />

      {rows.length ? (
        <>
          <div className="overflow-x-auto rounded-card bg-surface-container-lowest">
            <table className="w-full text-left text-body-md">
              <caption className="sr-only">Stock on hand</caption>
              <thead>
                <tr className="border-b border-outline-variant text-label-bold text-on-surface-variant">
                  <th scope="col" className="px-4 py-3 font-normal">Item</th>
                  <th scope="col" className="hidden px-4 py-3 font-normal sm:table-cell">Location</th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">On hand</th>
                  {anyHeld ? <th scope="col" className="px-4 py-3 text-right font-normal">Free</th> : null}
                  <th scope="col" className="hidden px-4 py-3 text-right font-normal md:table-cell">Low at</th>
                  {showCost ? <th scope="col" className="hidden px-4 py-3 text-right font-normal lg:table-cell">Worth</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const qty = (value) => formatQuantity(value, { precision: row.precision, unit: row.uom });
                  return (
                    <tr key={row.id} className="border-b border-outline-variant/60 last:border-0">
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/inventory-items/${row.itemId}`} className="text-label-bold text-on-surface hover:underline">{row.name}</Link>
                        <p className="text-on-surface-variant">
                          <span className="font-mono">{row.sku}</span>
                          {row.category ? ` · ${row.category.name}` : ""}
                          <span className="sm:hidden"> · {row.location.name}</span>
                        </p>
                      </td>
                      <td className="hidden px-4 py-3 text-on-surface-variant sm:table-cell">
                        {row.location.name}
                        {multiBranch ? <span className="block">{row.location.branch.name}</span> : null}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${Number(row.quantity) < 0 ? "text-error" : "text-on-surface"}`}>
                        {qty(row.quantity)}
                        {row.isLow ? <span className="mt-1 flex justify-end"><Chip tone="bg-warning-container text-on-warning-container">Low</Chip></span> : null}
                      </td>
                      {anyHeld ? (
                        <td className="px-4 py-3 text-right tabular-nums text-on-surface">
                          {qty(row.available)}
                          {Number(row.reserved) > 0 ? (
                            <span className="block text-label-md text-on-surface-variant">{qty(row.reserved)} promised</span>
                          ) : null}
                        </td>
                      ) : null}
                      <td className="hidden px-4 py-3 text-right tabular-nums text-on-surface-variant md:table-cell">{row.reorderLevel == null ? "—" : qty(row.reorderLevel)}</td>
                      {showCost ? (
                        <td className="hidden px-4 py-3 text-right tabular-nums text-on-surface-variant lg:table-cell">{formatMoney(Number(row.quantity) * Number(row.averageCost), currency)}</td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {cursor || page.nextCursor ? (
            <div className="flex flex-wrap gap-2">
              {cursor ? <Link href={href()} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">First page</Link> : null}
              {page.nextCursor ? <Link href={href({ cursor: page.nextCursor })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">Next page</Link> : null}
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState
          icon={Boxes}
          title={filtered ? "Nothing matches that" : "Nothing in stock yet"}
          action={filtered ? { href: "/dashboard/stock", label: "Clear filters" } : null}
        >
          {filtered ? "Try another search or location." : "Stock appears here once a delivery is received, a transfer arrives, or an adjustment adds it."}
        </EmptyState>
      )}

      {showBatches && batches.length ? (
        <Section title="Going off" description="Deliveries that expire within a week, or already have. Use them, or write them off so the loss is on record.">
          <ul className="flex flex-col gap-2">
            {batches.map((batch) => {
              const expiry = expiryState(batch.expiryDate);
              const qty = formatQuantity(batch.remainingQuantity, { precision: 3, unit: batch.item.uom.code });
              return (
                <li key={batch.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low p-3 text-body-md">
                  <span className="min-w-0">
                    <Link href={`/dashboard/inventory-items/${batch.item.id}`} className="block text-label-bold text-on-surface hover:underline">{batch.item.name}</Link>
                    <span className="text-on-surface-variant">
                      Batch {batch.batchNumber} · {batch.location.name} · {qty} left
                      {showCost ? ` · ${formatMoney(batch.valueAtRisk, currency)} at risk` : ""}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {batch.status === "QUARANTINED" ? <Chip tone="bg-error-container text-on-error-container">Held back</Chip> : null}
                    <Chip tone={expiry.tone}>{expiry.label}</Chip>
                    <BatchActions
                      batch={batch}
                      canQuarantine={can(principal, "stock_batches.quarantine", { branchId: batch.location.branchId })}
                      canWriteOff={can(principal, "stock_batches.write_off", { branchId: batch.location.branchId })}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
