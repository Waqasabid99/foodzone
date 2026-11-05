import Link from "next/link";
import { redirect } from "next/navigation";
import { ChartColumn } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { REPORTS, lastWeek } from "@/lib/insights";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Reports — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The operational reports, each behind its own permission.
 *
 * A hub rather than one page of tabs, because the permissions genuinely
 * differ — a kitchen manager may be trusted with product mix and not with
 * what the drivers earn — and a tab that refuses when clicked is a worse
 * answer than a card that was never offered.
 *
 * Each card says what its report *excludes*. That is the part people get
 * wrong: "sales" that quietly omits cancelled orders is right, and a reader
 * who does not know it is omitted will spend an afternoon reconciling it
 * against a figure that counts them.
 */
export default async function ReportsPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/reports"));
  const permissions = grantedPermissionKeys(principal);

  const available = REPORTS.filter((report) => hasPermission(permissions, report.permission));
  const range = lastWeek();

  // Someone holding only the creator-report permission lands here with
  // nothing to open, which is honest rather than broken — that programme is
  // not built yet, and the empty state says so instead of showing a card
  // that leads nowhere.
  const creatorOnly = !available.length && hasPermission(permissions, "reports.view_creator");
  if (!available.length && !creatorOnly) redirect("/dashboard");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        description="What the business actually did, read from the operational records rather than the ledger. Where a figure exists in both, the two are computed to agree."
      />

      {available.length ? (
        <ul className="grid gap-4 sm:grid-cols-2">
          {available.map((report) => (
            <li key={report.key}>
              <Link
                href={`/dashboard/reports/${report.key}?from=${range.from}&to=${range.to}`}
                className="flex h-full flex-col gap-2 rounded-card bg-surface-container-lowest p-5 hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span className="font-display text-headline-md text-on-surface">{report.label}</span>
                <span className="text-body-md text-on-surface-variant">{report.blurb}</span>
                <span className="mt-auto pt-2 text-label-bold font-normal text-on-surface-variant">{report.excludes}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={ChartColumn} title="Nothing to report on yet">
          Your access covers the creator programme, which has not been built. The other reports need their own
          permissions.
        </EmptyState>
      )}
    </div>
  );
}
