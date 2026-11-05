import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import ReportControls from "@/components/dashboard/finance/ReportControls";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import {
  balanceSheetReport,
  cashFlowReport,
  profitAndLossReport,
  trialBalanceReport,
} from "@/server/services/financial-report.service";
import { scopedBranches } from "@/server/content/finance-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { REPORTS, coverageLabel, dateLabel, statementHealth, toDateInput } from "@/lib/finance";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { report } = await params;
  const match = REPORTS.find((row) => row.key === report);
  return { title: `${match?.label ?? "Report"} — FoodZone`, robots: { index: false, follow: false } };
}

/** One section of a statement: account rows under a heading, with a total. */
function Section({ title, rows, total, currency, note = null }) {
  if (!rows.length) return null;
  return (
    <section className="flex flex-col gap-2 rounded-card bg-surface-container-lowest p-5">
      <h2 className="font-display text-headline-md text-on-surface">{title}</h2>
      {note ? <p className="text-body-md text-on-surface-variant">{note}</p> : null}
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li key={row.accountId} className="flex flex-wrap items-baseline justify-between gap-3 border-b border-outline-variant py-2 last:border-0">
            <Link href={`/dashboard/accounts/${row.accountId}`} className="min-w-0 text-body-md text-on-surface hover:underline">
              <span className="font-mono text-on-surface-variant">{row.code}</span> {row.name}
            </Link>
            <span className="tabular-nums text-body-md text-on-surface">{formatMoney(row.balance, currency)}</span>
          </li>
        ))}
      </ul>
      {total != null ? (
        <p className="flex flex-wrap items-baseline justify-between gap-3 border-t-2 border-outline pt-2 text-label-bold text-on-surface">
          <span>Total {title.toLowerCase()}</span>
          <span className="tabular-nums">{formatMoney(total, currency)}</span>
        </p>
      ) : null}
    </section>
  );
}

/**
 * One financial statement.
 *
 * **Every statement says what it covers, out loud, at the top.** Branch
 * scoping is invisible by design — a manager who can only see two outlets
 * gets two outlets' figures with no hint that is what happened. A page headed
 * "Profit & loss" that is quietly not the company's is the most dangerous
 * thing in this section, so the coverage is stated beside the dates rather
 * than inferred.
 *
 * When the books do not balance, that is said before the numbers rather than
 * in a footnote. If debits do not equal credits then every figure above is
 * suspect, and burying it under the totals makes the page a trap.
 */
export default async function StatementPage({ params, searchParams }) {
  const principal = await getAuthContext();
  const { report } = await params;
  const definition = REPORTS.find((row) => row.key === report);
  if (!definition) notFound();

  if (!principal) redirect(loginHref(`/dashboard/financial-reports/${report}`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, definition.permission)) redirect("/dashboard/financial-reports");

  const query = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);

  const scope = branchScope(principal, definition.permission);
  const branches = await scopedBranches(principal, definition.permission);
  const branch = branches.some((row) => row.id === one(query.branch)) ? one(query.branch) : "";
  const from = one(query.from) ?? "";
  const to = one(query.to) || toDateInput(new Date());

  const common = { ...(branch ? { branchId: branch } : {}), scope };
  const { currency } = await getSiteIdentity();

  const data = serialize(
    report === "profit-and-loss"
      ? await profitAndLossReport({ ...common, from: from || null, to })
      : report === "balance-sheet"
        ? await balanceSheetReport({ ...common, asOf: to })
        : report === "trial-balance"
          ? await trialBalanceReport({ ...common, from: from || null, to })
          : await cashFlowReport({ ...common, from: from || null, to }),
  );

  const coverage = coverageLabel({
    branchName: branches.find((row) => row.id === branch)?.name ?? null,
    scopedBranches: branches.map((row) => row.name),
    allBranches: scope.all && !scope.except?.length,
  });

  const health =
    report === "trial-balance"
      ? statementHealth({ balanced: data.balanced, kind: "trial balance" })
      : report === "balance-sheet"
        ? statementHealth({ balanced: data.balanced, kind: "balance sheet" })
        : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={definition.label}
        description={definition.blurb}
        back={{ href: "/dashboard/financial-reports", label: "Financial reports" }}
        actions={<Chip tone="bg-secondary-container text-on-secondary-container">{coverage}</Chip>}
      />

      <p className="text-body-md text-on-surface-variant">
        {report === "balance-sheet"
          ? `As at ${dateLabel(to)}`
          : from
            ? `${dateLabel(from)} to ${dateLabel(to)}`
            : `Everything up to ${dateLabel(to)} — no start date, so this covers the whole ledger`}
        {" · "}
        {coverage}
        {" · posted entries only"}
      </p>

      <ReportControls
        report={report}
        branches={serialize(branches)}
        value={{ from, to, branch }}
        showFrom={report !== "balance-sheet"}
        showAsOf={report === "balance-sheet"}
      />

      {health ? (
        <p role="status" className={`rounded-card px-5 py-4 ${health.tone}`}>
          <span className="block text-label-bold">{health.title}</span>
          <span className="block text-body-md">{health.body}</span>
        </p>
      ) : null}

      {report === "profit-and-loss" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Revenue", data.netRevenue],
              ["Cost of sales", data.costOfSales],
              ["Gross profit", data.grossProfit],
              ["Net profit", data.netProfit],
            ].map(([label, value]) => (
              <div key={label} className="rounded-card bg-surface-container-lowest p-5">
                <p className="text-label-bold text-on-surface-variant">{label}</p>
                <p className="tabular-nums font-display text-headline-md text-on-surface">{formatMoney(value, currency)}</p>
              </div>
            ))}
          </div>

          {data.grossMarginPercent != null ? (
            <p className="text-body-md text-on-surface-variant">
              Gross margin {data.grossMarginPercent}% · net margin {data.netMarginPercent}%
              {Number(data.contraRevenue) > 0
                ? ` · ${formatMoney(data.contraRevenue, currency)} of discounts and refunds already taken off revenue`
                : ""}
            </p>
          ) : null}

          <Section title="Income" rows={data.income} total={data.netRevenue} currency={currency} />
          <Section title="Expenses" rows={data.expenses} total={data.operatingExpenses} currency={currency} note="Cost of sales is shown above, separately from operating spend." />
        </>
      ) : null}

      {report === "balance-sheet" ? (
        <>
          <Section title="Assets" rows={data.assets} total={data.totalAssets} currency={currency} />
          <Section title="Liabilities" rows={data.liabilities} total={data.totalLiabilities} currency={currency} />
          <Section
            title="Equity"
            rows={data.equity}
            total={data.totalEquity}
            currency={currency}
            note={`Includes ${formatMoney(data.currentEarnings, currency)} of profit earned this period, which has not been closed out into equity yet.`}
          />
          <div className={`flex flex-wrap items-baseline justify-between gap-3 rounded-card p-5 ${data.balanced ? "bg-success-container text-on-success-container" : "bg-error-container text-on-error-container"}`}>
            <span className="text-label-bold">
              {data.balanced ? "Assets equal liabilities plus equity" : `Out by ${formatMoney(data.difference, currency)}`}
            </span>
            <span className="tabular-nums">{formatMoney(data.totalLiabilitiesAndEquity, currency)}</span>
          </div>
        </>
      ) : null}

      {report === "trial-balance" ? (
        <section className="flex flex-col gap-2 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">Every account with movement</h2>
          <ul className="flex flex-col">
            {data.accounts.map((row) => (
              <li key={row.accountId} className="flex flex-wrap items-baseline justify-between gap-3 border-b border-outline-variant py-2 last:border-0">
                <Link href={`/dashboard/accounts/${row.accountId}`} className="min-w-0 text-body-md text-on-surface hover:underline">
                  <span className="font-mono text-on-surface-variant">{row.code}</span> {row.name}
                  {row.isContrary ? <span className="ml-2 text-label-bold text-warning">on the unusual side</span> : null}
                </Link>
                <span className="flex shrink-0 gap-6">
                  <span className="tabular-nums text-body-md text-on-surface">{formatMoney(row.debit, currency)}</span>
                  <span className="tabular-nums text-body-md text-on-surface">{formatMoney(row.credit, currency)}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="flex flex-wrap items-baseline justify-between gap-3 border-t-2 border-outline pt-2 text-label-bold text-on-surface">
            <span>Totals</span>
            <span className="flex gap-6">
              <span className="tabular-nums">{formatMoney(data.totalDebit, currency)}</span>
              <span className="tabular-nums">{formatMoney(data.totalCredit, currency)}</span>
            </span>
          </p>
          {data.accounts.length ? null : (
            <p className="py-6 text-center text-body-md text-on-surface-variant">Nothing posted in this range.</p>
          )}
        </section>
      ) : null}

      {report === "cash-flow" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              ["In", data.inflow],
              ["Out", data.outflow],
              ["Net change", data.netChange],
            ].map(([label, value]) => (
              <div key={label} className="rounded-card bg-surface-container-lowest p-5">
                <p className="text-label-bold text-on-surface-variant">{label}</p>
                <p className="tabular-nums font-display text-headline-md text-on-surface">{formatMoney(value, currency)}</p>
              </div>
            ))}
          </div>

          <section className="flex flex-col gap-2 rounded-card bg-surface-container-lowest p-5">
            <h2 className="font-display text-headline-md text-on-surface">What moved the cash</h2>
            <p className="text-body-md text-on-surface-variant">
              Each movement is named by the other side of its own entry, so this reads as &ldquo;paid suppliers&rdquo;
              rather than a list of undifferentiated transfers.
            </p>
            {data.categories?.length ? (
              <ul className="flex flex-col">
                {data.categories.map((row) => (
                  <li key={row.category} className="flex flex-wrap items-baseline justify-between gap-3 border-b border-outline-variant py-2 last:border-0">
                    <span className="min-w-0 text-body-md text-on-surface">{row.category}</span>
                    <span className={`tabular-nums text-body-md ${Number(row.amount) < 0 ? "text-error" : "text-on-surface"}`}>
                      {formatMoney(row.amount, currency)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-body-md text-on-surface-variant">No cash moved in this range.</p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
