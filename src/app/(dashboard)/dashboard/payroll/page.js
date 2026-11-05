import Link from "next/link";
import { redirect } from "next/navigation";
import { Coins } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import PayrollPeriodForm from "@/components/dashboard/people/PayrollPeriodForm";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listPayrollPeriods } from "@/server/services/payroll.service";
import { scopedBranches } from "@/server/content/branch-scope";
import { PAYROLL_STATES, dayKey, dayLabel } from "@/lib/hr";
import { formatMoney } from "@/lib/format";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Payroll — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

/**
 * Pay runs.
 *
 * Payroll reads approved attendance, never raw punches: the day is the row a
 * supervisor looked at and signed, and paying from punches would pay what the
 * terminal recorded rather than what a human confirmed.
 */
export default async function PayrollPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/payroll"));
  if (!hasPermission(grantedPermissionKeys(principal), "payroll.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const status = PAYROLL_STATES[one(params.status)] ? one(params.status) : "";
  const cursor = one(params.cursor) || undefined;

  const branches = await scopedBranches(principal, "payroll.read");
  const branchId = branches.some((branch) => branch.id === one(params.branch)) ? one(params.branch) : "";

  const query = {
    ...(status ? { status } : {}),
    ...(branchId ? { branchId } : {}),
    scope: branchScope(principal, "payroll.read"),
    limit: PAGE_SIZE,
  };
  const page = await listPayrollPeriods({ ...query, cursor }).catch((error) => {
    if (cursor) return listPayrollPeriods(query);
    throw error;
  });
  const periods = serialize(page.items);
  const currency = branches[0]?.currency ?? "PKR";

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { status, branch: branchId, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    const text = query.toString();
    return text ? `/dashboard/payroll?${text}` : "/dashboard/payroll";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payroll"
        description="Built from attendance that has been signed off — not from raw punches, and not from anything still waiting on a supervisor."
        actions={
          hasPermission(grantedPermissionKeys(principal), "payslips.view_all") ? (
            <Link href="/dashboard/payslips" className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              All payslips
            </Link>
          ) : null
        }
      />

      <ListFilters
        id="payroll"
        fields={[
          { type: "select", name: "status", label: "Status", value: status, options: [{ value: "", label: "Any status" }, ...Object.entries(PAYROLL_STATES).map(([value, state]) => ({ value, label: state.label }))] },
          ...(branches.length > 1
            ? [{ type: "select", name: "branch", label: "Branch", value: branchId, options: [{ value: "", label: "Any branch" }, ...branches.map((branch) => ({ value: branch.id, label: branch.name }))] }]
            : []),
        ]}
      />

      {periods.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {periods.map((period) => {
              const state = PAYROLL_STATES[period.status] ?? PAYROLL_STATES.DRAFT;
              return (
                <li key={period.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/payroll/${period.id}`} className="text-label-bold text-on-surface hover:underline">{period.name}</Link>
                      <Chip tone={state.tone}>{state.label}</Chip>
                    </p>
                    <p className="mt-1 text-body-md text-on-surface-variant">
                      {dayLabel(dayKey(period.startDate), { weekday: false })} to {dayLabel(dayKey(period.endDate), { weekday: false })}
                      {" · "}
                      {period.payslipCount} {period.payslipCount === 1 ? "payslip" : "payslips"}
                      {period.branchId && branches.length > 1 ? ` · ${branches.find((b) => b.id === period.branchId)?.name ?? "one branch"}` : ""}
                    </p>
                  </div>
                  <p className="text-right text-body-md text-on-surface-variant">
                    <span className="block text-label-bold text-on-surface">{formatMoney(period.totalNet, currency)}</span>
                    net of {formatMoney(period.totalGross, currency)}
                  </p>
                </li>
              );
            })}
          </ul>

          {cursor || page.nextCursor ? (
            <div className="flex flex-wrap gap-2">
              {cursor ? <Link href={href({ cursor: "" })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">Most recent</Link> : null}
              {page.nextCursor ? <Link href={href({ cursor: page.nextCursor })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">Older</Link> : null}
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState icon={Coins} title={status || branchId ? "Nothing matches that" : "No pay runs yet"}>
          A run covers a period, generates a payslip per employee from their approved attendance, and posts the wage
          bill once you approve it.
        </EmptyState>
      )}

      {can(principal, "payroll.process") ? <PayrollPeriodForm branches={serialize(branches)} /> : null}
    </div>
  );
}
