import Link from "next/link";
import { redirect } from "next/navigation";
import { Contact, Plus } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listEmployees } from "@/server/services/employee.service";
import { departmentOptions } from "@/server/content/people-admin";
import { scopedBranches } from "@/server/content/branch-scope";
import { salaryVisible, withoutPay } from "@/server/hr/access";
import { EMPLOYEE_STATES, EMPLOYMENT_TYPES, employeeName, employmentTypeLabel } from "@/lib/hr";
import { formatMoney } from "@/lib/format";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Employees — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/**
 * Everyone who works here.
 *
 * An employee is not a user: staff sign in with the `User` account they hold
 * roles on, but plenty never sign in at all. This list is about the contract —
 * who works where, on what terms, for what.
 *
 * Pay is shown per row rather than per page, because a list can span branches
 * where only some of them carry `employees.view_salary`.
 */
export default async function EmployeesPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/employees"));
  if (!hasPermission(grantedPermissionKeys(principal), "employees.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const search = String(one(params.q) ?? "").trim().slice(0, 100);
  const status = EMPLOYEE_STATES[one(params.status)] ? one(params.status) : "";
  const employmentType = EMPLOYMENT_TYPES[one(params.type)] ? one(params.type) : "";
  const cursor = one(params.cursor) || undefined;

  const scope = branchScope(principal, "employees.read");
  const [branches, departments] = await Promise.all([
    scopedBranches(principal, "employees.read"),
    departmentOptions({ includeInactive: true }),
  ]);
  const branchId = branches.some((branch) => branch.id === one(params.branch)) ? one(params.branch) : "";
  const departmentId = departments.some((department) => department.id === one(params.department)) ? one(params.department) : "";

  const query = {
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
    ...(employmentType ? { employmentType } : {}),
    ...(branchId ? { branchId } : {}),
    ...(departmentId ? { departmentId } : {}),
    scope,
    includeSalary: true,
    limit: PAGE_SIZE,
  };

  const page = await listEmployees({ ...query, cursor }).catch((error) => {
    // A stale cursor from a bookmarked link should show the first page, not an error.
    if (cursor) return listEmployees(query);
    throw error;
  });
  const employees = serialize(page.items.map((row) => (salaryVisible(principal, row.branchId) ? row : withoutPay(row))));
  const branchName = (id) => branches.find((branch) => branch.id === id)?.name ?? null;

  const filtered = Boolean(search || status || employmentType || branchId || departmentId);
  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { q: search, status, type: employmentType, branch: branchId, department: departmentId, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    const text = query.toString();
    return text ? `/dashboard/employees?${text}` : "/dashboard/employees";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Employees"
        description="Everyone on the payroll — the contract, not the login. Somebody who never signs in still gets rostered and paid."
        actions={
          can(principal, "employees.create") ? (
            <Link href="/dashboard/employees/new" className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <Plus aria-hidden="true" className="size-4" />
              New employee
            </Link>
          ) : null
        }
      />

      <ListFilters
        id="employees"
        fields={[
          { type: "search", name: "q", label: "Search", value: search, placeholder: "Name or staff number" },
          { type: "select", name: "status", label: "Status", value: status, options: [{ value: "", label: "Any status" }, ...Object.entries(EMPLOYEE_STATES).map(([value, state]) => ({ value, label: state.label }))] },
          { type: "select", name: "type", label: "Type", value: employmentType, options: [{ value: "", label: "Any type" }, ...Object.entries(EMPLOYMENT_TYPES).map(([value, label]) => ({ value, label }))] },
          ...(departments.length
            ? [{ type: "select", name: "department", label: "Department", value: departmentId, options: [{ value: "", label: "Any department" }, ...departments.map((department) => ({ value: department.id, label: department.name }))] }]
            : []),
          ...(branches.length > 1
            ? [{ type: "select", name: "branch", label: "Branch", value: branchId, options: [{ value: "", label: "Any branch" }, ...branches.map((branch) => ({ value: branch.id, label: branch.name }))] }]
            : []),
        ]}
      />

      {employees.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {employees.map((employee) => {
              const state = EMPLOYEE_STATES[employee.status] ?? EMPLOYEE_STATES.ACTIVE;
              return (
                <li key={employee.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/employees/${employee.id}`} className="text-label-bold text-on-surface hover:underline">
                        {employeeName(employee)}
                      </Link>
                      <Chip tone={state.tone}>{state.label}</Chip>
                      {employee.biometricId ? null : <Chip tone="bg-warning-container text-on-warning-container">Not enrolled</Chip>}
                    </p>
                    <p className="mt-1 text-body-md text-on-surface-variant">
                      {employee.employeeCode} · {employee.designation ?? employmentTypeLabel(employee.employmentType)}
                      {employee.department ? ` · ${employee.department.name}` : ""}
                      {branches.length > 1 && branchName(employee.branchId) ? ` · ${branchName(employee.branchId)}` : ""}
                    </p>
                  </div>
                  {employee.baseSalary != null ? (
                    <p className="text-right text-body-md text-on-surface-variant">
                      <span className="block text-label-bold text-on-surface">{formatMoney(employee.baseSalary, employee.currency ?? "PKR")}</span>
                      {employee.salaryType === "MONTHLY" ? "a month" : employee.salaryType === "DAILY" ? "a day" : "an hour"}
                    </p>
                  ) : null}
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
        <EmptyState
          icon={Contact}
          title={filtered ? "Nobody matches that" : "No employees yet"}
          action={can(principal, "employees.create") ? { href: "/dashboard/employees/new", label: "Add someone" } : null}
        >
          {filtered ? "Try a different search or clear the filters." : "Add your staff, then build a roster and let attendance follow."}
        </EmptyState>
      )}
    </div>
  );
}
