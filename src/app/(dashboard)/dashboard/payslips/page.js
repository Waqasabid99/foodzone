import Link from "next/link";
import { redirect } from "next/navigation";
import { FileBadge } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listPayrollPeriods, listPayslips } from "@/server/services/payroll.service";
import { employeeOptions } from "@/server/content/people-admin";
import { PAYROLL_STATES, durationLabel, employeeName } from "@/lib/hr";
import { formatMoney } from "@/lib/format";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Payslips — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * Everybody's payslips.
 *
 * Behind `payslips.view_all` rather than `payslips.read`: reading your own
 * payslip needs nothing but being you, and conflating the two is how one
 * endpoint ends up handing over the whole payroll.
 */
export default async function PayslipsPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/payslips"));
  if (!hasPermission(grantedPermissionKeys(principal), "payslips.view_all")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const status = PAYROLL_STATES[one(params.status)] ? one(params.status) : "";
  const cursor = one(params.cursor) || undefined;

  const scope = branchScope(principal, "payslips.view_all");
  const [periodPage, employees] = await Promise.all([
    listPayrollPeriods({ limit: 50, scope: branchScope(principal, "payroll.read") }),
    hasPermission(grantedPermissionKeys(principal), "employees.read")
      ? employeeOptions(branchScope(principal, "employees.read"), { includeLeft: true })
      : [],
  ]);
  const periods = periodPage.items ?? periodPage;
  const periodId = periods.some((period) => period.id === one(params.period)) ? one(params.period) : "";
  const employeeId = employees.some((employee) => employee.id === one(params.employee)) ? one(params.employee) : "";

  const query = {
    ...(periodId ? { periodId } : {}),
    ...(employeeId ? { employeeId } : {}),
    ...(status ? { status } : {}),
    scope,
    limit: PAGE_SIZE,
  };
  const page = await listPayslips({ ...query, cursor }).catch((error) => {
    if (cursor) return listPayslips(query);
    throw error;
  });
  const payslips = serialize(page.items);

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { period: periodId, employee: employeeId, status, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    const text = query.toString();
    return text ? `/dashboard/payslips?${text}` : "/dashboard/payslips";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payslips"
        description="One per employee per pay run, frozen at the attendance figures it was built from."
        actions={
          hasPermission(grantedPermissionKeys(principal), "payroll.read") ? (
            <Link href="/dashboard/payroll" className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              Pay runs
            </Link>
          ) : null
        }
      />

      <ListFilters
        id="payslips"
        fields={[
          ...(periods.length
            ? [{ type: "select", name: "period", label: "Pay run", value: periodId, options: [{ value: "", label: "Any run" }, ...periods.map((period) => ({ value: period.id, label: period.name }))] }]
            : []),
          ...(employees.length
            ? [{ type: "select", name: "employee", label: "Who", value: employeeId, options: [{ value: "", label: "Everyone" }, ...employees.map((employee) => ({ value: employee.id, label: employeeName(employee) }))] }]
            : []),
          { type: "select", name: "status", label: "Status", value: status, options: [{ value: "", label: "Any status" }, ...Object.entries(PAYROLL_STATES).map(([value, state]) => ({ value, label: state.label }))] },
        ]}
      />

      {payslips.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {payslips.map((payslip) => {
              const state = PAYROLL_STATES[payslip.status] ?? PAYROLL_STATES.DRAFT;
              const currency = payslip.employee?.currency ?? "PKR";
              return (
                <li key={payslip.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/payslips/${payslip.id}`} className="text-label-bold text-on-surface hover:underline">
                        {employeeName(payslip.employee)}
                      </Link>
                      <Chip tone={state.tone}>{state.label}</Chip>
                    </p>
                    <p className="mt-1 text-body-md text-on-surface-variant">
                      {payslip.employee?.employeeCode} · {Number(payslip.payableDays)} payable days ·{" "}
                      {durationLabel(payslip.workedMinutes)} worked
                      {payslip.overtimeMinutes ? ` · ${durationLabel(payslip.overtimeMinutes)} overtime` : ""}
                    </p>
                  </div>
                  <p className="text-right text-body-md text-on-surface-variant">
                    <span className="block text-label-bold text-on-surface">{formatMoney(payslip.netAmount, currency)}</span>
                    gross {formatMoney(payslip.grossAmount, currency)}
                  </p>
                </li>
              );
            })}
          </ul>

          {cursor || page.nextCursor ? (
            <div className="flex flex-wrap gap-2">
              {cursor ? <Link href={href({ cursor: "" })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">First page</Link> : null}
              {page.nextCursor ? <Link href={href({ cursor: page.nextCursor })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">Next</Link> : null}
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState icon={FileBadge} title={periodId || employeeId || status ? "Nothing matches that" : "No payslips yet"}>
          Payslips appear once a pay run generates them from approved attendance.
        </EmptyState>
      )}
    </div>
  );
}
