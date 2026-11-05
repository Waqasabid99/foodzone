import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftRight } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getSiteIdentity } from "@/server/content/site";
import { itemOptions, scopedBranches, scopedLocations, userNames } from "@/server/content/inventory-admin";
import { listMovements } from "@/server/services/stock.service";
import { MOVEMENT_TYPES, formatQuantity, movementLabel, movementSource } from "@/lib/inventory";
import { endOfLocalDay, localMidnight } from "@/lib/menu-schedule";
import { hasPermission } from "@/lib/dashboard-nav";
import { formatMoney } from "@/lib/format";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Stock movements — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The stock ledger: every change to every shelf, newest first.
 *
 * Append-only and the source of truth — the Stock page is this list added up.
 * Each line says what caused it and links to that document, because "12 kg
 * of chicken left on Tuesday" is only useful next to "sold" or "wasted".
 */
export default async function StockMovementsPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/stock-movements"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "stock_movements.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const type = MOVEMENT_TYPES[one(params.type)] ? one(params.type) : "";
  const from = DATE.test(one(params.from) ?? "") ? one(params.from) : "";
  const to = DATE.test(one(params.to) ?? "") ? one(params.to) : "";
  const cursor = one(params.cursor) || undefined;

  const scope = branchScope(principal, "stock_movements.read");
  const [branches, locations, items, { currency }] = await Promise.all([
    scopedBranches(principal, "stock_movements.read"),
    scopedLocations(principal, "stock_movements.read", { activeOnly: false }),
    itemOptions({ includeInactive: true }),
    getSiteIdentity(),
  ]);
  const branch = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : "";
  const location = locations.some((row) => row.id === one(params.location)) ? one(params.location) : "";
  const item = items.some((row) => row.id === one(params.item)) ? one(params.item) : "";

  // Dates are the business's days, not the server's: "the 3rd" ends at
  // midnight where the restaurant is.
  const zone = branches.find((row) => row.id === branch)?.timezone ?? branches[0]?.timezone ?? "UTC";
  const start = from ? localMidnight(from, zone) : null;
  // The last instant of the "to" day: the next local midnight, less a millisecond.
  const toStart = to ? localMidnight(to, zone) : null;
  const end = toStart ? new Date(endOfLocalDay(zone, toStart).getTime() - 1) : null;

  const page = await listMovements({
    ...(item ? { itemId: item } : {}),
    ...(branch ? { branchId: branch } : {}),
    ...(location ? { locationId: location } : {}),
    ...(type ? { type } : {}),
    ...(start ? { from: start } : {}),
    ...(end ? { to: end } : {}),
    scope,
    limit: PAGE_SIZE,
    cursor,
  }).catch((error) => {
    if (cursor) return listMovements({ scope, limit: PAGE_SIZE });
    throw error;
  });

  const movements = serialize(page.items);
  const names = await userNames(movements.map((movement) => movement.performedById));
  const showCost = hasPermission(permissions, "stock.view_valuation");
  const multiBranch = branches.length > 1;
  const filtered = Boolean(item || branch || location || type || from || to);

  const href = (extra = {}) => {
    const search = new URLSearchParams();
    const values = { item, branch, location, type, from, to, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) search.set(key, String(value));
    const query = search.toString();
    return query ? `/dashboard/stock-movements?${query}` : "/dashboard/stock-movements";
  };

  const when = (date) =>
    new Date(date).toLocaleString("en-GB", { timeZone: zone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Stock movements"
        description="Every change to stock, newest first — deliveries, sales, waste, transfers, counts. Nothing here is ever edited or deleted; a mistake is corrected by a new line."
      />

      <ListFilters
        id="movements"
        submitLabel="Apply"
        fields={[
          { type: "select", name: "item", label: "Item", value: item, options: [{ value: "", label: "Every item" }, ...items.map((row) => ({ value: row.id, label: row.isActive ? row.name : `${row.name} (off)` }))] },
          ...(multiBranch ? [{ type: "select", name: "branch", label: "Branch", value: branch, options: [{ value: "", label: "All branches" }, ...branches.map((row) => ({ value: row.id, label: row.name }))] }] : []),
          ...(locations.length > 1 ? [{ type: "select", name: "location", label: "Location", value: location, options: [{ value: "", label: "Every location" }, ...locations.map((row) => ({ value: row.id, label: multiBranch ? `${row.name} — ${row.branch.name}` : row.name }))] }] : []),
          { type: "select", name: "type", label: "What happened", value: type, options: [{ value: "", label: "Anything" }, ...Object.entries(MOVEMENT_TYPES).map(([value, meta]) => ({ value, label: meta.label }))] },
          { type: "date", name: "from", label: "From", value: from },
          { type: "date", name: "to", label: "To", value: to },
        ]}
      />

      {movements.length ? (
        <>
          <div className="overflow-x-auto rounded-card bg-surface-container-lowest">
            <table className="w-full text-left text-body-md">
              <caption className="sr-only">Stock movements</caption>
              <thead>
                <tr className="border-b border-outline-variant text-label-bold text-on-surface-variant">
                  <th scope="col" className="px-4 py-3 font-normal">What</th>
                  <th scope="col" className="hidden px-4 py-3 font-normal md:table-cell">Where</th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">Change</th>
                  <th scope="col" className="hidden px-4 py-3 text-right font-normal sm:table-cell">Left after</th>
                  {showCost ? <th scope="col" className="hidden px-4 py-3 text-right font-normal lg:table-cell">Cost</th> : null}
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => {
                  const source = movementSource(movement);
                  const qty = (value, options) => formatQuantity(value, { precision: movement.item.uom.precision, unit: movement.item.uom.code, ...options });
                  return (
                    <tr key={movement.id} className="border-b border-outline-variant/60 align-top last:border-0">
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/inventory-items/${movement.item.id}`} className="text-label-bold text-on-surface hover:underline">{movement.item.name}</Link>
                        <p className="text-on-surface">
                          {movementLabel(movement.type)}
                          {source ? (source.href ? <> · <Link href={source.href} className="text-primary hover:underline">{source.label}</Link></> : ` · ${source.label}`) : null}
                        </p>
                        <p className="text-on-surface-variant">
                          {when(movement.occurredAt)}
                          {names[movement.performedById] ? ` · ${names[movement.performedById]}` : movement.type === "SALE_OUT" ? " · automatic" : ""}
                          <span className="md:hidden"> · {movement.location.name}</span>
                        </p>
                        {movement.notes && !source ? <p className="text-on-surface-variant">“{movement.notes}”</p> : null}
                      </td>
                      <td className="hidden px-4 py-3 text-on-surface-variant md:table-cell">
                        {movement.location.name}
                        {multiBranch ? <span className="block">{movement.location.branch.name}</span> : null}
                        {movement.batch ? <span className="block">Batch {movement.batch.batchNumber}</span> : null}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums text-label-bold ${Number(movement.quantity) < 0 ? "text-error" : "text-success"}`}>
                        {qty(movement.quantity, { signed: true })}
                      </td>
                      <td className="hidden px-4 py-3 text-right tabular-nums text-on-surface-variant sm:table-cell">{movement.balanceAfter == null ? "—" : qty(movement.balanceAfter)}</td>
                      {showCost ? <td className="hidden px-4 py-3 text-right tabular-nums text-on-surface-variant lg:table-cell">{formatMoney(movement.totalCost, currency)}</td> : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {cursor || page.nextCursor ? (
            <div className="flex flex-wrap gap-2">
              {cursor ? <Link href={href()} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">Newest</Link> : null}
              {page.nextCursor ? <Link href={href({ cursor: page.nextCursor })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">Older</Link> : null}
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState icon={ArrowLeftRight} title={filtered ? "No movements match that" : "Nothing has moved yet"} action={filtered ? { href: "/dashboard/stock-movements", label: "Clear filters" } : null}>
          {filtered ? "Try a wider date range or another item." : "Each delivery, sale, transfer, count and piece of waste adds a line here."}
        </EmptyState>
      )}
    </div>
  );
}
