import Link from "next/link";
import { redirect } from "next/navigation";
import { ChartNoAxesCombined } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { REPORTS, lastMonth } from "@/lib/finance";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Financial reports — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The four statements, each behind its own permission.
 *
 * A hub rather than one page with tabs, because the permissions genuinely
 * differ — somebody may be trusted with a profit and loss and not with a
 * balance sheet — and a tab that 403s when clicked is a worse answer than a
 * card that was never offered.
 */
export default async function FinancialReportsPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/financial-reports"));
  const permissions = grantedPermissionKeys(principal);

  const available = REPORTS.filter((report) => hasPermission(permissions, report.permission));
  if (!available.length) redirect("/dashboard");

  const range = lastMonth();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Financial reports"
        description="Drawn from posted entries only. A draft is somebody's unfinished work, and including it would make a statement change under the reader as a colleague typed."
      />

      {available.length ? (
        <ul className="grid gap-4 sm:grid-cols-2">
          {available.map((report) => (
            <li key={report.key}>
              <Link
                href={`/dashboard/financial-reports/${report.key}?from=${range.from}&to=${range.to}`}
                className="flex h-full flex-col gap-2 rounded-card bg-surface-container-lowest p-5 hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span className="font-display text-headline-md text-on-surface">{report.label}</span>
                <span className="text-body-md text-on-surface-variant">{report.blurb}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={ChartNoAxesCombined} title="No statements available to you" />
      )}
    </div>
  );
}
