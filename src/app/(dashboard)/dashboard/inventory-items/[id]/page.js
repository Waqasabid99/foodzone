import Link from "next/link";
import { nullIfMissing } from "@/lib/api/errors";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import StatTile from "@/components/dashboard/StatTile";
import ItemForm from "@/components/dashboard/inventory/ItemForm";
import ActionButton from "@/components/dashboard/inventory/ActionButton";
import Chip from "@/components/dashboard/inventory/Chip";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys, holdsCompanyWide } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getSiteIdentity } from "@/server/content/site";
import { categoryOptions, unitOptions, userNames } from "@/server/content/inventory-admin";
import { getItem } from "@/server/services/inventory-item.service";
import { listMovements } from "@/server/services/stock.service";
import { ITEM_TYPES, expiryState, formatQuantity, movementLabel, movementSource } from "@/lib/inventory";
import { hasPermission } from "@/lib/dashboard-nav";
import { formatMoney } from "@/lib/format";
import { loginHref } from "@/lib/redirects";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const item = await getItem(id).catch(() => null);
  return { title: item ? `${item.name} — Stock items — FoodZone` : "Stock item — FoodZone", robots: { index: false, follow: false } };
}

const when = (date) => new Date(date).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * One item: where it is, what it is worth, what happened to it lately.
 *
 * Quantities are the viewer's branches only. Costs appear only for someone
 * who may see valuation, because a cost price is the margin in disguise.
 */
export default async function InventoryItemPage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/inventory-items/${id}`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "inventory_items.read")) redirect("/dashboard");

  const raw = await nullIfMissing(getItem(id, { scope: branchScope(principal, "inventory_items.read") }));
  if (!raw) notFound();

  const canSeeMovements = hasPermission(permissions, "stock_movements.read");
  const [{ currency }, categories, units, recent] = await Promise.all([
    getSiteIdentity(),
    categoryOptions(),
    unitOptions(),
    canSeeMovements ? listMovements({ itemId: id, scope: branchScope(principal, "stock_movements.read"), limit: 10 }) : { items: [] },
  ]);
  const names = await userNames(recent.items.map((movement) => movement.performedById));

  const item = serialize(raw);
  const movements = serialize(recent.items);
  const precision = item.uom.precision;
  const qty = (value, options = {}) => formatQuantity(value, { precision, unit: item.uom.code, ...options });
  const showCost = hasPermission(permissions, "stock.view_valuation");
  const canUpdate = holdsCompanyWide(principal, "inventory_items.update");
  const kind = ITEM_TYPES.find((type) => type.value === item.type)?.label ?? item.type;
  const isLow = item.isLow;

  const quick =
    "inline-flex items-center rounded-field border border-outline px-4 py-2.5 text-label-bold text-on-surface hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={item.name}
        description={`${kind} · counted in ${item.uom.name.toLowerCase()} (${item.uom.code}) · SKU ${item.sku}`}
        back={{ href: "/dashboard/inventory-items", label: "Stock items" }}
        actions={
          <div className="flex flex-wrap gap-2">
            {!item.isActive ? <Chip>Switched off</Chip> : isLow ? <Chip tone="bg-warning-container text-on-warning-container">Low stock</Chip> : null}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="On hand" value={qty(item.onHand)} note={item.reorderLevel != null ? `Low at ${qty(item.reorderLevel)}` : "No reorder level"} />
        {showCost ? (
          <>
            <StatTile label="Worth" value={formatMoney(item.stockValue, currency)} note="At average cost" />
            <StatTile label="Average cost" value={Number(item.averageCost) ? formatMoney(item.averageCost, currency) : "—"} note={`Per ${item.uom.code}`} />
            <StatTile label="Last delivery" value={item.lastPurchaseCost ? formatMoney(item.lastPurchaseCost, currency) : "—"} note={`Per ${item.uom.code}`} />
          </>
        ) : (
          <StatTile label="Locations" value={String(item.stockLevels.length)} note="Holding any" />
        )}
      </div>

      {item.isActive ? (
        <div className="flex flex-wrap gap-2">
          {hasPermission(permissions, "stock_adjustments.create") ? (
            <Link href={`/dashboard/stock-adjustments/new?item=${item.id}`} className={quick}>Adjust stock</Link>
          ) : null}
          {hasPermission(permissions, "wastage.create") ? (
            <Link href={`/dashboard/wastage?record=1&item=${item.id}`} className={quick}>Record waste</Link>
          ) : null}
          {hasPermission(permissions, "stock_transfers.create") ? (
            <Link href={`/dashboard/stock-transfers/new?item=${item.id}`} className={quick}>Transfer</Link>
          ) : null}
        </div>
      ) : null}

      <Section title="Where it is" description={item.stockLevels.length ? null : "None of it is anywhere yet. A delivery, a transfer in, or an adjustment adding stock puts it on a shelf."}>
        {item.stockLevels.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-body-md">
              <caption className="sr-only">Stock by location</caption>
              <thead>
                <tr className="border-b border-outline-variant text-label-bold text-on-surface-variant">
                  <th scope="col" className="py-2 pr-4 font-normal">Location</th>
                  <th scope="col" className="py-2 pr-4 text-right font-normal">On hand</th>
                  {showCost ? <th scope="col" className="hidden py-2 text-right font-normal sm:table-cell">Worth</th> : null}
                </tr>
              </thead>
              <tbody>
                {item.stockLevels.map((level) => (
                  <tr key={level.location.id} className="border-b border-outline-variant/60 last:border-0">
                    <td className="py-2 pr-4 text-on-surface">
                      {level.location.name}
                      <span className="block text-on-surface-variant">{level.location.branch.name}</span>
                    </td>
                    <td className={`py-2 pr-4 text-right tabular-nums ${Number(level.quantity) < 0 ? "text-error" : "text-on-surface"}`}>
                      {qty(level.quantity)}
                      {item.reorderLevel != null && Number(level.quantity) <= Number(item.reorderLevel) ? (
                        <span className="mt-1 flex justify-end"><Chip tone="bg-warning-container text-on-warning-container">Low</Chip></span>
                      ) : null}
                    </td>
                    {showCost ? (
                      <td className="hidden py-2 text-right tabular-nums text-on-surface-variant sm:table-cell">{formatMoney(Number(level.quantity) * Number(item.averageCost), currency)}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>

      {item.batches.length ? (
        <Section title="Deliveries on the shelf" description="Each delivery kept separately, oldest date first — the order they are used in.">
          <ul className="flex flex-col gap-2">
            {item.batches.map((batch) => {
              const expiry = expiryState(batch.expiryDate);
              return (
                <li key={batch.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low p-3 text-body-md">
                  <span>
                    <span className="block text-label-bold text-on-surface">Batch {batch.batchNumber}</span>
                    <span className="text-on-surface-variant">
                      {batch.location.name} · {qty(batch.remainingQuantity)} left
                      {showCost ? ` · ${formatMoney(batch.unitCost, currency)} / ${item.uom.code}` : ""}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    {batch.status === "QUARANTINED" ? <Chip tone="bg-error-container text-on-error-container">Held back</Chip> : null}
                    <Chip tone={expiry.tone}>{expiry.label}</Chip>
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      {canSeeMovements ? (
        <Section title="Recent movements" description={movements.length ? null : "Nothing has moved yet."}>
          {movements.length ? (
            <>
              <ul className="flex flex-col divide-y divide-outline-variant/60">
                {movements.map((movement) => {
                  const source = movementSource(movement);
                  return (
                    <li key={movement.id} className="flex flex-wrap items-baseline justify-between gap-3 py-2 text-body-md">
                      <span className="min-w-0">
                        <span className="block text-on-surface">
                          {movementLabel(movement.type)}
                          {source ? (
                            source.href ? (
                              <>
                                {" · "}
                                <Link href={source.href} className="text-primary hover:underline">{source.label}</Link>
                              </>
                            ) : (
                              ` · ${source.label}`
                            )
                          ) : null}
                        </span>
                        <span className="text-on-surface-variant">
                          {when(movement.occurredAt)} · {movement.location.name}
                          {names[movement.performedById] ? ` · ${names[movement.performedById]}` : ""}
                        </span>
                      </span>
                      <span className={`tabular-nums text-label-bold ${Number(movement.quantity) < 0 ? "text-error" : "text-success"}`}>
                        {qty(movement.quantity, { signed: true })}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <Link href={`/dashboard/stock-movements?item=${item.id}`} className="w-fit text-label-bold text-primary hover:underline">Every movement of {item.name}</Link>
            </>
          ) : null}
        </Section>
      ) : null}

      <ItemForm item={item} categories={categories} units={units} unitLocked={item._count.movements > 0} readOnly={!canUpdate} />

      {item.isActive && holdsCompanyWide(principal, "inventory_items.delete") ? (
        <section className="flex flex-col gap-3 rounded-card border border-outline-variant p-5 sm:p-6">
          <h2 className="font-display text-headline-md text-on-surface">Switch off</h2>
          <p className="text-body-md text-on-surface-variant">
            Hides it from pickers and new documents. Its history stays — the ledger names it forever. Only possible with none of it in stock anywhere; write off or transfer what is left first.
            {item._count.recipeIngredients ? ` It is used in ${item._count.recipeIngredients} recipe ${item._count.recipeIngredients === 1 ? "line" : "lines"}, which will keep deducting it until changed.` : ""}
          </p>
          <ActionButton method="delete" endpoint={`/admin/inventory-items/${item.id}`} tone="danger" confirm={`Switch off ${item.name}?`} success={`${item.name} switched off.`}>
            Switch off {item.name}
          </ActionButton>
        </section>
      ) : null}
      {!item.isActive && canUpdate ? (
        <section className="flex flex-col gap-3 rounded-card border border-outline-variant p-5 sm:p-6">
          <h2 className="font-display text-headline-md text-on-surface">Switched off</h2>
          <p className="text-body-md text-on-surface-variant">It is hidden from pickers and cannot be put on new documents.</p>
          <ActionButton method="patch" endpoint={`/admin/inventory-items/${item.id}`} body={{ isActive: true }} tone="primary" success={`${item.name} switched back on.`}>
            Switch back on
          </ActionButton>
        </section>
      ) : null}
    </div>
  );
}
