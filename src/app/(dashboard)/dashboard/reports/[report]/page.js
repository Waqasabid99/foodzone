import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import ChartCard from "@/components/dashboard/ChartCard";
import BarBreakdown from "@/components/dashboard/BarBreakdown";
import StatTile from "@/components/dashboard/StatTile";
import RangeControls from "@/components/dashboard/insights/RangeControls";
import SalesTrend from "@/components/dashboard/insights/SalesTrend";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import {
  deliveryReport,
  inventoryReport,
  productMixReport,
  salesReport,
} from "@/server/services/operational-report.service";
import { attendanceSummary } from "@/server/services/attendance.service";
import { hasAnyOrders, scopedBranches } from "@/server/content/insights-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { coverageLabel } from "@/lib/finance";
import {
  REPORTS,
  bucketLabel,
  channelLabel,
  dateLabel,
  fillDays,
  isGrouping,
  lastWeek,
  onTimeTone,
  rateIsMeaningful,
  reportByKey,
  shareOf,
  toDateInput,
  topRows,
  typeLabel,
} from "@/lib/insights";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { report } = await params;
  return { title: `${reportByKey(report)?.label ?? "Report"} — FoodZone`, robots: { index: false, follow: false } };
}

/**
 * One operational report.
 *
 * Two rules run through all five.
 *
 * **Every report states what it covers.** Branch scoping is invisible by
 * design, so a manager who can see two outlets gets two outlets' figures
 * with nothing on the page saying so. A sales report that is quietly not the
 * company's is the most misleading thing in this section.
 *
 * **A rate is withheld when there is not enough behind it.** "100% on time"
 * off two deliveries is noise wearing a number's clothes, and it is exactly
 * the figure that gets quoted in a meeting. Below the floor the count is
 * shown instead.
 */
export default async function ReportPage({ params, searchParams }) {
  const principal = await getAuthContext();
  const { report } = await params;
  const definition = reportByKey(report);
  if (!definition) notFound();

  if (!principal) redirect(loginHref(`/dashboard/reports/${report}`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, definition.permission)) redirect("/dashboard/reports");

  const query = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);

  const scope = branchScope(principal, definition.permission);
  const branches = await scopedBranches(principal, definition.permission);
  const branch = branches.some((row) => row.id === one(query.branch)) ? one(query.branch) : "";
  const fallback = lastWeek();
  const from = one(query.from) ?? fallback.from;
  const to = one(query.to) || toDateInput(new Date());
  const groupBy = isGrouping(one(query.groupBy)) ? one(query.groupBy) : "day";

  const { currency } = await getSiteIdentity();
  const common = { ...(branch ? { branchId: branch } : {}), scope };

  const coverage = coverageLabel({
    branchName: branches.find((row) => row.id === branch)?.name ?? null,
    scopedBranches: branches.map((row) => row.name),
    allBranches: scope.all && !scope.except?.length,
  });

  const header = (
    <PageHeader
      title={definition.label}
      description={definition.blurb}
      back={{ href: "/dashboard/reports", label: "Reports" }}
      actions={<Chip tone="bg-secondary-container text-on-secondary-container">{coverage}</Chip>}
    />
  );

  const range =
    report === "inventory" ? (
      <p className="text-body-md text-on-surface-variant">
        As things stand right now · {coverage} · {definition.excludes}
      </p>
    ) : (
      <p className="text-body-md text-on-surface-variant">
        {dateLabel(from)} to {dateLabel(to)} · {coverage} · {definition.excludes}
      </p>
    );

  const controls = (
    <RangeControls
      basePath={`/dashboard/reports/${report}`}
      branches={serialize(branches)}
      value={{ from, to, branch, groupBy }}
      showDates={report !== "inventory"}
      showGrouping={report === "sales"}
    />
  );

  // ---------------------------------------------------------------- sales --
  if (report === "sales") {
    const data = serialize(await salesReport({ ...common, from, to, groupBy }));
    const ever = data.totals.orders === 0 ? await hasAnyOrders(principal) : true;
    const series = groupBy === "day" ? fillDays(data.series, { from, to }) : data.series;

    const byType = topRows(data.byType, { limit: 8, label: (row) => typeLabel(row.key), value: (row) => row.revenue, meta: (row) => `${row.orders} ${row.orders === 1 ? "order" : "orders"}` });
    const byChannel = topRows(data.byChannel, { limit: 8, label: (row) => channelLabel(row.key), value: (row) => row.revenue, meta: (row) => `${row.orders} ${row.orders === 1 ? "order" : "orders"}` });

    return (
      <div className="flex flex-col gap-6">
        {header}
        {range}
        {controls}

        {data.totals.orders === 0 ? (
          <p className="rounded-card bg-surface-container-lowest px-5 py-8 text-center text-body-md text-on-surface-variant">
            {ever
              ? "No completed orders in this range. Try a wider one."
              : "No completed orders have been recorded at all yet, so there is nothing to report on."}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Net sales" value={formatMoney(data.totals.netSales, currency)} note={`${data.totals.orders} completed ${data.totals.orders === 1 ? "order" : "orders"}.`} />
          <StatTile label="Average order" value={formatMoney(data.totals.averageOrderValue, currency)} note="Net sales divided by orders." />
          <StatTile label="Discounts given" value={formatMoney(data.totals.discounts, currency)} note={`${shareOf(data.totals.discounts, data.totals.grossSales) ?? 0}% of gross.`} tone="inverse" />
          <StatTile label="Items sold" value={String(data.totals.items)} note="Lines across every completed order." />
        </div>

        <ChartCard
          title="Revenue over time"
          subtitle={`Bucketed ${groupBy === "day" ? "by day" : groupBy === "hour" ? "by hour" : "by month"}. Quiet periods are drawn as zero rather than skipped, so a closed day reads as closed.`}
          columns={[
            { key: "period", label: "Period" },
            { key: "orders", label: "Orders", align: "right" },
            { key: "revenue", label: "Revenue", align: "right" },
          ]}
          rows={series.map((row) => ({
            key: row.period,
            period: bucketLabel(row.period, { long: true }),
            orders: row.orders,
            revenue: formatMoney(row.revenue, currency),
          }))}
        >
          <SalesTrend data={series} currency={currency} />
        </ChartCard>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="By order type"
            subtitle="Where the revenue comes from."
            columns={[
              { key: "label", label: "Type" },
              { key: "value", label: "Revenue", align: "right" },
            ]}
            rows={byType.map((row) => ({ key: row.label, label: row.label, value: formatMoney(row.value, currency) }))}
          >
            <BarBreakdown data={byType} currency={currency} />
          </ChartCard>

          <ChartCard
            title="By channel"
            subtitle="How the order reached the kitchen."
            columns={[
              { key: "label", label: "Channel" },
              { key: "value", label: "Revenue", align: "right" },
            ]}
            rows={byChannel.map((row) => ({ key: row.label, label: row.label, value: formatMoney(row.value, currency) }))}
          >
            <BarBreakdown data={byChannel} currency={currency} />
          </ChartCard>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------- product mix --
  if (report === "product-mix") {
    // `productMixReport` answers with a plain array, already sorted by
    // revenue — not a wrapper object like the other three.
    const items = serialize(await productMixReport({ ...common, from, to, limit: 50 }));
    const byRevenue = topRows(items, { limit: 8, label: (row) => row.name, value: (row) => row.revenue, meta: (row) => `${row.quantitySold} sold` });
    const costed = items.filter((row) => row.margin != null);

    return (
      <div className="flex flex-col gap-6">
        {header}
        {range}
        {controls}

        {costed.length < items.length ? (
          <p className="rounded-card bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant">
            {items.length - costed.length} of {items.length} dishes have no recipe, so no cost and no margin can be
            worked out for them. They are listed, with the margin left blank rather than shown as zero — a dish with
            no recipe is not a dish with no cost.
          </p>
        ) : null}

        <ChartCard
          title="Best sellers by revenue"
          subtitle="Volume and revenue are different questions — a cheap dish can top one and not the other."
          columns={[
            { key: "label", label: "Dish" },
            { key: "value", label: "Revenue", align: "right" },
          ]}
          rows={byRevenue.map((row) => ({ key: row.label, label: row.label, value: formatMoney(row.value, currency) }))}
        >
          <BarBreakdown data={byRevenue} currency={currency} height={280} />
        </ChartCard>

        {items.length ? (
          <section className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
            <h2 className="font-display text-headline-md text-on-surface">Every dish sold</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-body-md">
                <thead>
                  <tr className="border-b border-outline-variant text-left">
                    {["Dish", "Sold", "Revenue", "Cost", "Margin"].map((label, index) => (
                      <th key={label} scope="col" className={`pb-2 text-label-bold text-on-surface-variant ${index > 0 ? "text-right" : ""}`}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.variantId} className="border-b border-outline-variant/50 last:border-0">
                      <td className="py-2 text-on-surface">{row.name}</td>
                      <td className="py-2 text-right tabular-nums text-on-surface">{row.quantitySold}</td>
                      <td className="py-2 text-right tabular-nums text-on-surface">{formatMoney(row.revenue, currency)}</td>
                      <td className="py-2 text-right tabular-nums text-on-surface-variant">
                        {row.cost == null ? "—" : formatMoney(row.cost, currency)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-on-surface">
                        {row.margin == null ? (
                          <span className="text-on-surface-variant">no recipe</span>
                        ) : (
                          <>
                            {formatMoney(row.margin, currency)}
                            {row.marginPercent != null ? (
                              <span className="block text-label-bold font-normal text-on-surface-variant">{row.marginPercent}%</span>
                            ) : null}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <p className="rounded-card bg-surface-container-lowest px-5 py-8 text-center text-body-md text-on-surface-variant">
            Nothing was sold in this range.
          </p>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------ inventory --
  if (report === "inventory") {
    const data = serialize(await inventoryReport(common));
    const byValue = topRows(data.items, { limit: 8, label: (row) => row.name, value: (row) => row.value, meta: (row) => `${row.quantity} ${row.uom ?? ""}`.trim() });

    return (
      <div className="flex flex-col gap-6">
        {header}
        {range}
        {controls}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile label="Stock on hand" value={formatMoney(data.totalValue, currency)} note="At what it cost, not what it sells for." />
          <StatTile label="Items tracked" value={String(data.itemCount)} note="Lines with a stock level recorded." />
          <StatTile
            label="Below reorder level"
            value={String(data.belowReorder)}
            note={data.belowReorder ? "These will run out before the next delivery if nobody orders." : "Nothing needs ordering."}
            tone="inverse"
          />
        </div>

        {data.items.length ? (
          <ChartCard
            title="Where the money is sitting"
            subtitle="The few lines that hold most of the value are the ones worth counting often."
            columns={[
              { key: "label", label: "Item" },
              { key: "value", label: "Value", align: "right" },
            ]}
            rows={byValue.map((row) => ({ key: row.label, label: row.label, value: formatMoney(row.value, currency) }))}
          >
            <BarBreakdown data={byValue} currency={currency} height={280} />
          </ChartCard>
        ) : (
          <p className="rounded-card bg-surface-container-lowest px-5 py-8 text-center text-body-md text-on-surface-variant">
            No stock is being tracked yet.
          </p>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------- delivery --
  if (report === "delivery") {
    const data = serialize(await deliveryReport({ ...common, from, to }));
    const totals = data.totals;
    const onTime = onTimeTone(totals.onTimePercent, { count: totals.completed });
    const byDriver = topRows(data.drivers, {
      limit: 8,
      label: (row) => row.name ?? "A driver",
      value: (row) => row.deliveries,
      meta: (row) => (rateIsMeaningful(row.deliveries) && row.onTimePercent != null ? `${row.onTimePercent}% on time` : `${row.deliveries} too few to rate`),
    });

    return (
      <div className="flex flex-col gap-6">
        {header}
        {range}
        {controls}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Delivered" value={String(totals.completed)} note={`${totals.deliveries} jobs in all, ${totals.cancelled} cancelled.`} />
          <StatTile
            label="On time"
            value={rateIsMeaningful(totals.completed) && totals.onTimePercent != null ? `${totals.onTimePercent}%` : "—"}
            note={onTime.note}
          />
          <StatTile
            label="Average door to door"
            value={totals.averageMinutes != null ? `${totals.averageMinutes} min` : "—"}
            note="Across completed jobs only."
          />
          <StatTile label="Still out" value={String(totals.inFlight)} note="Jobs neither delivered nor cancelled." />
        </div>

        {data.drivers.length ? (
          <ChartCard
            title="Jobs per rider"
            subtitle="How the work was shared out. On-time is in the tooltip, and withheld for anyone with too few jobs to rate."
            columns={[
              { key: "label", label: "Rider" },
              { key: "value", label: "Jobs", align: "right" },
              { key: "meta", label: "On time", align: "right" },
            ]}
            rows={byDriver.map((row) => ({ key: row.label, label: row.label, value: row.value, meta: row.meta }))}
          >
            <BarBreakdown data={byDriver} height={280} format={(value) => `${value} ${value === 1 ? "job" : "jobs"}`} />
          </ChartCard>
        ) : (
          <p className="rounded-card bg-surface-container-lowest px-5 py-8 text-center text-body-md text-on-surface-variant">
            No deliveries in this range.
          </p>
        )}
      </div>
    );
  }

  // ----------------------------------------------------------- attendance --
  const rows = serialize(
    await attendanceSummary({ from, to, scope: branchScope(principal, "reports.view_hr") }),
  );
  const unapproved = rows.reduce((sum, row) => sum + row.unapprovedDays, 0);

  return (
    <div className="flex flex-col gap-6">
      {header}
      {range}
      {controls}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile label="Employees with days recorded" value={String(rows.length)} note="Anyone with at least one day in the range." />
        <StatTile
          label="Days nobody has approved"
          value={String(unapproved)}
          note={unapproved ? "Payroll will read these as they stand unless somebody looks." : "Every recorded day has been approved."}
          tone="inverse"
        />
        <StatTile
          label="Payable days"
          value={String(rows.reduce((sum, row) => sum + row.payableDays, 0))}
          note="Present, plus paid leave and holidays."
        />
      </div>

      {rows.length ? (
        <section className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">By employee</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-body-md">
              <thead>
                <tr className="border-b border-outline-variant text-left">
                  {["Employee", "Present", "Leave", "Absent", "Holiday", "Payable", "Unapproved"].map((label, index) => (
                    <th key={label} scope="col" className={`pb-2 text-label-bold text-on-surface-variant ${index > 0 ? "text-right" : ""}`}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.employeeId} className="border-b border-outline-variant/50 last:border-0">
                    <td className="py-2 text-on-surface">
                      <Link href={`/dashboard/employees/${row.employeeId}`} className="hover:underline">
                        {row.employee?.user?.name ?? row.employee?.code ?? "An employee"}
                      </Link>
                    </td>
                    <td className="py-2 text-right tabular-nums text-on-surface">{row.presentDays}</td>
                    <td className="py-2 text-right tabular-nums text-on-surface">{row.leaveDays}</td>
                    <td className="py-2 text-right tabular-nums text-on-surface">{row.absentDays}</td>
                    <td className="py-2 text-right tabular-nums text-on-surface">{row.holidayDays}</td>
                    <td className="py-2 text-right tabular-nums text-label-bold text-on-surface">{row.payableDays}</td>
                    <td className={`py-2 text-right tabular-nums ${row.unapprovedDays ? "text-warning" : "text-on-surface-variant"}`}>
                      {row.unapprovedDays}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-body-md text-on-surface-variant">
            The month as payroll will read it. An unapproved day still counts — approval is a review, not a gate.
          </p>
        </section>
      ) : (
        <p className="rounded-card bg-surface-container-lowest px-5 py-8 text-center text-body-md text-on-surface-variant">
          No attendance was recorded in this range.
        </p>
      )}
    </div>
  );
}
