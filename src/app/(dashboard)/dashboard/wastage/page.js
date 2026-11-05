import Link from "next/link";
import { redirect } from "next/navigation";
import { Trash2 } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import StatTile from "@/components/dashboard/StatTile";
import ChartCard from "@/components/dashboard/ChartCard";
import BarBreakdown from "@/components/dashboard/BarBreakdown";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import ActionButton from "@/components/dashboard/inventory/ActionButton";
import WastageRecorder from "@/components/dashboard/inventory/WastageRecorder";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getSiteIdentity } from "@/server/content/site";
import { actionableLocations, itemOptions, levelMap, scopedBranches, scopedLocations, userNames } from "@/server/content/inventory-admin";
import { listWastage, wastageReport } from "@/server/services/stock-adjustment.service";
import { WASTAGE_REASONS, formatQuantity, selfApproved, wastageReasonLabel } from "@/lib/inventory";
import { localMidnight, endOfLocalDay, zonedDateInput } from "@/lib/menu-schedule";
import { hasPermission } from "@/lib/dashboard-nav";
import { formatMoney } from "@/lib/format";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Wastage — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What was thrown away, and why.
 *
 * Grouped by reason because that is the cut a kitchen acts on: "expired"
 * points at over-ordering, "cooking mistake" at training, "spoiled" at a
 * fridge. Recording takes stock out at once; review comes after.
 */
export default async function WastagePage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/wastage"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "wastage.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const reason = WASTAGE_REASONS.some((row) => row.value === one(params.reason)) || one(params.reason) === "PRODUCTION_LOSS" ? one(params.reason) : "";
  const reviewed = one(params.reviewed) === "yes" ? true : one(params.reviewed) === "no" ? false : undefined;
  const cursor = one(params.cursor) || undefined;

  const scope = branchScope(principal, "wastage.read");
  const [branches, locations, recordable, items] = await Promise.all([
    scopedBranches(principal, "wastage.read"),
    scopedLocations(principal, "wastage.read", { activeOnly: false }),
    actionableLocations(principal, "wastage.create"),
    itemOptions(),
  ]);
  const branch = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : "";
  const location = locations.some((row) => row.id === one(params.location)) ? one(params.location) : "";
  const zone = branches.find((row) => row.id === branch)?.timezone ?? branches[0]?.timezone ?? "UTC";

  // Thirty days by default: long enough to see a pattern, short enough to act on.
  const today = zonedDateInput(new Date(), zone);
  const defaultFrom = shiftDay(today, -29);
  const from = DATE.test(one(params.from) ?? "") ? one(params.from) : defaultFrom;
  const to = DATE.test(one(params.to) ?? "") ? one(params.to) : today;
  const start = localMidnight(from, zone);
  const toStart = localMidnight(to, zone);
  const end = toStart ? new Date(endOfLocalDay(zone, toStart).getTime() - 1) : null;

  const filters = {
    ...(branch ? { branchId: branch } : {}),
    ...(start ? { from: start } : {}),
    ...(end ? { to: end } : {}),
  };

  const [{ currency }, report, page, levels] = await Promise.all([
    getSiteIdentity(),
    wastageReport({ ...filters, scope }),
    listWastage({
      ...filters,
      ...(location ? { locationId: location } : {}),
      ...(reason ? { reason } : {}),
      ...(reviewed !== undefined ? { reviewed } : {}),
      scope,
      limit: PAGE_SIZE,
      cursor,
    }).catch((error) => {
      if (cursor) return listWastage({ ...filters, scope, limit: PAGE_SIZE });
      throw error;
    }),
    levelMap(recordable.map((row) => row.id)),
  ]);

  const records = serialize(page.items);
  const summary = serialize(report);
  const names = await userNames(records.flatMap((row) => [row.recordedById, row.approvedById]));
  const multiBranch = branches.length > 1;
  const itemPrecision = new Map(items.map((row) => [row.id, row.uom.precision]));
  /*
   * The reason most is thrown away for.
   *
   * Ranked by cost when there is cost to rank by, and by how often otherwise.
   * A shop that has not received any goods yet has no cost basis for anything,
   * so every row is worth zero — and the tile showed a dash where the reason
   * should be, on a screen whose whole subject is *why* food is thrown away.
   * The money is the part that can be unknown; the reason never is.
   */
  const byCost = summary.byReason.filter((row) => Number(row.value) > 0);
  const top = byCost[0] ?? [...summary.byReason].sort((a, b) => b.count - a.count)[0];

  const href = (extra = {}) => {
    const search = new URLSearchParams();
    const values = {
      branch,
      location,
      reason,
      reviewed: reviewed === true ? "yes" : reviewed === false ? "no" : "",
      from: from === defaultFrom ? "" : from,
      to: to === today ? "" : to,
      ...extra,
    };
    for (const [key, value] of Object.entries(values)) if (value) search.set(key, String(value));
    const query = search.toString();
    return query ? `/dashboard/wastage?${query}` : "/dashboard/wastage";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Wastage"
        description="Food and stock thrown away, and why. It leaves stock the moment it is recorded; a manager reviews it afterwards."
      />

      {recordable.length ? (
        <WastageRecorder
          locations={serialize(recordable)}
          items={serialize(items)}
          levels={levels}
          defaultItemId={items.some((row) => row.id === one(params.item)) ? one(params.item) : ""}
          startOpen={one(params.record) === "1"}
        />
      ) : null}

      <ListFilters
        id="wastage"
        submitLabel="Apply"
        fields={[
          ...(multiBranch ? [{ type: "select", name: "branch", label: "Branch", value: branch, options: [{ value: "", label: "All branches" }, ...branches.map((row) => ({ value: row.id, label: row.name }))] }] : []),
          ...(locations.length > 1 ? [{ type: "select", name: "location", label: "Location", value: location, options: [{ value: "", label: "Every location" }, ...locations.map((row) => ({ value: row.id, label: multiBranch ? `${row.name} — ${row.branch.name}` : row.name }))] }] : []),
          { type: "select", name: "reason", label: "Reason", value: reason, options: [{ value: "", label: "Any reason" }, ...WASTAGE_REASONS.map((row) => ({ value: row.value, label: row.label })), { value: "PRODUCTION_LOSS", label: "Production loss" }] },
          { type: "select", name: "reviewed", label: "Review", value: reviewed === true ? "yes" : reviewed === false ? "no" : "", options: [{ value: "", label: "Everything" }, { value: "no", label: "Not reviewed" }, { value: "yes", label: "Reviewed" }] },
          { type: "date", name: "from", label: "From", value: from },
          { type: "date", name: "to", label: "To", value: to },
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Lost" value={formatMoney(summary.totalValue, currency)} note={`${from === defaultFrom && to === today ? "Last 30 days" : "In this range"}${branch ? "" : multiBranch ? ", your branches" : ""}`} />
        <StatTile label="Times recorded" value={String(summary.recordCount)} />
        <StatTile
          label="Biggest reason"
          value={top ? wastageReasonLabel(top.reason) : "—"}
          note={
            top
              ? Number(top.value) > 0
                ? formatMoney(top.value, currency)
                : `${top.count} ${top.count === 1 ? "time" : "times"} · nothing has a cost yet`
              : null
          }
        />
      </div>

      {summary.byReason.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Why it was thrown away"
            subtitle="By cost"
            columns={[
              { key: "label", label: "Reason" },
              { key: "count", label: "Times", align: "right" },
              { key: "value", label: "Cost", align: "right" },
            ]}
            rows={summary.byReason.map((row) => ({ key: row.reason, label: wastageReasonLabel(row.reason), count: row.count, value: formatMoney(row.value, currency) }))}
          >
            <BarBreakdown
              currency={currency}
              height={Math.max(140, summary.byReason.length * 38)}
              data={summary.byReason.map((row) => ({ label: wastageReasonLabel(row.reason), value: Number(row.value), meta: `${row.count} ${row.count === 1 ? "time" : "times"}` }))}
            />
          </ChartCard>
          <ChartCard
            title="What was thrown away"
            subtitle="Top items by cost"
            columns={[
              { key: "label", label: "Item" },
              { key: "quantity", label: "Amount", align: "right" },
              { key: "value", label: "Cost", align: "right" },
            ]}
            rows={summary.topItems.slice(0, 8).map((row) => ({
              key: row.item.id,
              label: row.item.name ?? "Unknown",
              quantity: formatQuantity(row.quantity, { precision: itemPrecision.get(row.item.id) ?? 3, unit: row.item.uom?.code }),
              value: formatMoney(row.value, currency),
            }))}
          >
            <BarBreakdown
              currency={currency}
              height={Math.max(140, Math.min(8, summary.topItems.length) * 38)}
              data={summary.topItems.slice(0, 8).map((row) => ({
                label: row.item.name ?? "Unknown",
                value: Number(row.value),
                meta: formatQuantity(row.quantity, { precision: itemPrecision.get(row.item.id) ?? 3, unit: row.item.uom?.code }),
              }))}
            />
          </ChartCard>
        </div>
      ) : null}

      {records.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {records.map((record) => {
              const canReview = !record.approvedById && can(principal, "wastage.approve", { branchId: record.location.branchId });
              return (
                <li key={record.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/inventory-items/${record.item.id}`} className="text-label-bold text-on-surface hover:underline">{record.item.name}</Link>
                      <span className="tabular-nums text-on-surface">{formatQuantity(record.quantity, { precision: itemPrecision.get(record.item.id) ?? 3, unit: record.item.uom.code })}</span>
                      <Chip>{wastageReasonLabel(record.reason)}</Chip>
                      {record.approvedById ? (
                        <Chip tone="bg-success-container text-on-success-container">{selfApproved(record.recordedById, record.approvedById) ? "Self-reviewed" : "Reviewed"}</Chip>
                      ) : null}
                    </p>
                    {record.notes ? <p className="mt-1 text-body-md text-on-surface">“{record.notes}”</p> : null}
                    <p className="text-body-md text-on-surface-variant">
                      {record.location.name}
                      {multiBranch ? ` · ${record.location.branch.name}` : ""}
                      {` · ${new Date(record.occurredAt).toLocaleString("en-GB", { timeZone: zone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
                      {names[record.recordedById] ? ` · ${names[record.recordedById]}` : ""}
                      {record.approvedById && names[record.approvedById] && !selfApproved(record.recordedById, record.approvedById) ? ` · reviewed by ${names[record.approvedById]}` : ""}
                      {record.productionOrder ? ` · production ${record.productionOrder.productionNumber}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <p className="tabular-nums text-label-bold text-on-surface">{formatMoney(record.totalCost, currency)}</p>
                    {canReview ? (
                      <ActionButton endpoint={`/admin/wastage/${record.id}/approve`} success="Marked as reviewed.">Mark reviewed</ActionButton>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {cursor || page.nextCursor ? (
            <div className="flex flex-wrap gap-2">
              {cursor ? <Link href={href()} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">Newest</Link> : null}
              {page.nextCursor ? <Link href={href({ cursor: page.nextCursor })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">Older</Link> : null}
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState icon={Trash2} title="Nothing thrown away in this range">
          {reason || location || reviewed !== undefined ? "Try another reason, location or range." : "Record waste as it happens — the sooner it is on record, the more useful the pattern."}
        </EmptyState>
      )}
    </div>
  );
}

/** A YYYY-MM-DD date moved by whole days, on the calendar rather than the clock. */
function shiftDay(day, days) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
