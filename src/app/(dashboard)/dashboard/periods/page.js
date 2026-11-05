import { redirect } from "next/navigation";
import { CalendarRange } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import PeriodActions from "@/components/dashboard/finance/PeriodActions";
import FiscalYearForm from "@/components/dashboard/finance/FiscalYearForm";
import FiscalRunway from "@/components/dashboard/finance/FiscalRunway";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys, holdsCompanyWide } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { fiscalYears, periodsWithReadiness, userNames } from "@/server/content/finance-admin";
import { fiscalRunway } from "@/server/services/fiscal.service";
import { runwayNotice } from "@/lib/fiscal-runway";
import { PERIOD_STATES, dateLabel, timeLabel } from "@/lib/finance";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Accounting periods — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The months the books are kept in.
 *
 * Company data: a period is closed for the whole company or not at all, so
 * nothing here is cut by branch, and closing one takes a company-wide grant.
 * A finance role pinned to a single outlet shutting the books on every other
 * outlet is exactly the kind of thing that only shows up at a year end.
 *
 * Why a month cannot be closed is on the row. The subtle one is ordering:
 * closing out of sequence leaves a closed month sitting in front of an open
 * one, whose figures can still move underneath a report that has gone out.
 */
export default async function PeriodsPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/periods"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "accounting_periods.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);

  const years = await fiscalYears();
  const yearId = years.some((row) => row.id === one(params.year)) ? one(params.year) : (years[0]?.id ?? null);
  const periods = serialize(await periodsWithReadiness(yearId ? { fiscalYearId: yearId } : {}));
  const people = await userNames(periods.map((row) => row.closedById));

  const canClose = holdsCompanyWide(principal, "accounting_periods.close");

  /*
   * Where the next year starts, and whether anybody needs telling.
   *
   * Both come from one service read, so the banner, the notification the daily
   * job sends and this form cannot disagree about the answer. The suggestion
   * is the day after the latest year on file running twelve months — it
   * follows the *books* rather than the configured default, because a business
   * that ran a short transition year keeps its own calendar. Every field stays
   * editable: a year that does not run January to December is normal, not an
   * edge case, and a date field filled from scratch at year end is a date
   * field somebody fills in wrong.
   */
  const iso = (date) => new Date(date).toISOString().slice(0, 10);
  const runway = await fiscalRunway();
  const suggestion = {
    name: runway.suggestion.name,
    startDate: iso(runway.suggestion.startDate),
    endDate: iso(runway.suggestion.endDate),
  };

  const canReopen = holdsCompanyWide(principal, "accounting_periods.reopen");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Accounting periods"
        description="The months the books are kept in. Closing one stops anything posting into it, which is what makes a reported figure stay reported."
      />

      {/* Creating a year takes the same company-wide grant closing one does:
          both decide what the whole company's books look like. */}
      {canClose ? <FiscalRunway notice={runwayNotice(runway)} href={null} /> : null}
      {canClose ? <FiscalYearForm suggestion={suggestion} /> : null}

      {years.length > 1 ? (
        <form method="get" className="flex flex-wrap items-end gap-3 rounded-card bg-surface-container-lowest p-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="period-year" className="text-label-bold text-on-surface">Financial year</label>
            <select id="period-year" name="year" defaultValue={yearId ?? ""} className="min-h-11 rounded-field bg-surface-container-low px-3 text-body-md text-on-surface">
              {years.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                  {year.isClosed ? " (closed)" : ""}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="min-h-11 rounded-field bg-surface-container-high px-5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            Show
          </button>
        </form>
      ) : null}

      {!canClose && hasPermission(permissions, "accounting_periods.close") ? (
        <p className="rounded-card bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant">
          You can close periods at a branch, but a period belongs to the whole company — closing one closes it
          everywhere. That needs a company-wide grant, so the buttons are not offered here.
        </p>
      ) : null}

      {periods.length ? (
        <ul className="flex flex-col gap-3">
          {periods.map((period) => {
            const state = PERIOD_STATES[period.status] ?? { label: period.status, tone: "", note: "" };
            return (
              <li key={period.id} className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-headline-md text-on-surface">{period.name}</span>
                      <Chip tone={state.tone}>{state.label}</Chip>
                    </p>
                    <p className="mt-1 text-body-md text-on-surface-variant">
                      {dateLabel(period.startDate)} to {dateLabel(period.endDate)} · {period.entryCount}{" "}
                      {period.entryCount === 1 ? "entry" : "entries"}
                      {period.drafts ? ` · ${period.drafts} still a draft` : ""}
                    </p>
                    {period.closedAt ? (
                      <p className="text-body-md text-on-surface-variant">
                        Closed {timeLabel(period.closedAt)}
                        {people[period.closedById] ? ` by ${people[period.closedById]}` : ""}
                      </p>
                    ) : null}
                  </div>
                </div>

                <PeriodActions period={period} canClose={canClose} canReopen={canReopen} />
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState icon={CalendarRange} title="No periods">
          A financial year has to be created before the books have months to post into.
        </EmptyState>
      )}
    </div>
  );
}
