import Link from "next/link";
import { redirect } from "next/navigation";
import { Plane } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import LeaveRequestForm from "@/components/dashboard/people/LeaveRequestForm";
import LeaveDecision from "@/components/dashboard/people/LeaveDecision";
import LeaveTypesEditor from "@/components/dashboard/people/LeaveTypesEditor";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listLeaveRequests, listLeaveTypes } from "@/server/services/leave.service";
import { employeeOptions, userNames } from "@/server/content/people-admin";
import { scopedBranches } from "@/server/content/branch-scope";
import { LEAVE_STATES, dayKey, dayLabel, employeeName } from "@/lib/hr";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Leave — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/**
 * Leave requests, and the kinds of leave they can be.
 *
 * Balance is consumed on approval rather than on request. Holding days against
 * a pending request sounds fairer but means a manager sitting on an approval
 * blocks the employee from asking for anything else, and a rejection then has
 * to hand the days back — one more path to get wrong.
 */
export default async function LeavePage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/leave"));
  if (!hasPermission(grantedPermissionKeys(principal), "leave_requests.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const status = LEAVE_STATES[one(params.status)] ? one(params.status) : "";
  const cursor = one(params.cursor) || undefined;

  const scope = branchScope(principal, "leave_requests.read");
  const [branches, leaveTypes, employees] = await Promise.all([
    scopedBranches(principal, "leave_requests.read"),
    listLeaveTypes(),
    hasPermission(grantedPermissionKeys(principal), "employees.read")
      ? employeeOptions(branchScope(principal, "employees.read"))
      : [],
  ]);
  const branchId = branches.some((branch) => branch.id === one(params.branch)) ? one(params.branch) : "";
  const leaveTypeId = leaveTypes.some((type) => type.id === one(params.type)) ? one(params.type) : "";

  const query = {
    ...(status ? { status } : {}),
    ...(branchId ? { branchId } : {}),
    ...(leaveTypeId ? { leaveTypeId } : {}),
    scope,
    limit: PAGE_SIZE,
  };
  const page = await listLeaveRequests({ ...query, cursor }).catch((error) => {
    if (cursor) return listLeaveRequests(query);
    throw error;
  });
  const requests = serialize(page.items);
  const reviewers = await userNames(requests.map((request) => request.reviewedById));

  const canApprove = can(principal, "leave_requests.approve");
  const canReject = can(principal, "leave_requests.reject");
  const canCancel = can(principal, "leave_requests.cancel");
  const canCreate = can(principal, "leave_requests.create") && employees.length > 0;
  const canManageTypes = can(principal, "leave_types.manage");
  const canSeeTypes = hasPermission(grantedPermissionKeys(principal), "leave_types.read");

  const waiting = requests.filter((request) => request.status === "PENDING").length;
  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { status, branch: branchId, type: leaveTypeId, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    const text = query.toString();
    return text ? `/dashboard/leave?${text}` : "/dashboard/leave";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Leave"
        description="Nothing comes off a balance until leave is approved — approval is the commitment, and it rewrites the attendance those days cover."
        actions={waiting ? <Chip tone="bg-warning-container text-on-warning-container">{waiting} waiting</Chip> : null}
      />

      <ListFilters
        id="leave"
        fields={[
          { type: "select", name: "status", label: "Status", value: status, options: [{ value: "", label: "Any status" }, ...Object.entries(LEAVE_STATES).map(([value, state]) => ({ value, label: state.label }))] },
          ...(leaveTypes.length
            ? [{ type: "select", name: "type", label: "Kind", value: leaveTypeId, options: [{ value: "", label: "Any kind" }, ...leaveTypes.map((type) => ({ value: type.id, label: type.name }))] }]
            : []),
          ...(branches.length > 1
            ? [{ type: "select", name: "branch", label: "Branch", value: branchId, options: [{ value: "", label: "Any branch" }, ...branches.map((branch) => ({ value: branch.id, label: branch.name }))] }]
            : []),
        ]}
      />

      {requests.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {requests.map((request) => {
              const state = LEAVE_STATES[request.status] ?? LEAVE_STATES.PENDING;
              const days = Number(request.totalDays);
              return (
                <li key={request.id} className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <Link href={`/dashboard/employees/${request.employeeId}`} className="text-label-bold text-on-surface hover:underline">
                          {employeeName(request.employee)}
                        </Link>
                        <Chip tone={state.tone}>{state.label}</Chip>
                        {request.leaveType?.isPaid ? null : <Chip tone="bg-warning-container text-on-warning-container">Unpaid</Chip>}
                      </p>
                      <p className="mt-1 text-body-md text-on-surface-variant">
                        {request.leaveType?.name} · {dayLabel(dayKey(request.startDate), { weekday: false })}
                        {dayKey(request.endDate) !== dayKey(request.startDate) ? ` to ${dayLabel(dayKey(request.endDate), { weekday: false })}` : ""}
                      </p>
                      {request.reason ? <p className="mt-1 text-body-md text-on-surface-variant">{request.reason}</p> : null}
                      {request.reviewedAt ? (
                        <p className="mt-1 text-body-md text-on-surface-variant">
                          {state.label} by {reviewers.get(request.reviewedById) ?? "someone"}
                          {request.reviewNote ? ` — ${request.reviewNote}` : ""}
                        </p>
                      ) : null}
                    </div>
                    <p className="text-right text-label-bold text-on-surface">{days} {days === 1 ? "day" : "days"}</p>
                  </div>

                  <LeaveDecision
                    request={request}
                    canApprove={canApprove}
                    canReject={canReject}
                    canCancel={canCancel}
                  />
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
        <EmptyState icon={Plane} title={status || leaveTypeId || branchId ? "Nothing matches that" : "No leave requested"}>
          Requests appear here as staff ask for time off.
        </EmptyState>
      )}

      {canCreate ? (
        <Section title="Book leave for somebody" description="For requests that arrive by word of mouth rather than through the app.">
          <LeaveRequestForm employees={serialize(employees)} leaveTypes={serialize(leaveTypes.filter((type) => type.isActive))} />
        </Section>
      ) : null}

      {canSeeTypes ? (
        <Section title="Kinds of leave" description="What can be asked for, and how many days a year each one grants.">
          <LeaveTypesEditor leaveTypes={serialize(leaveTypes)} canManage={canManageTypes} />
        </Section>
      ) : null}
    </div>
  );
}
