import Link from "next/link";
import { redirect } from "next/navigation";
import { PencilRuler, Plus } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getSiteIdentity } from "@/server/content/site";
import { actionableLocations, scopedBranches, userNames } from "@/server/content/inventory-admin";
import { adjustmentCounts, listAdjustments } from "@/server/services/stock-adjustment.service";
import { ADJUSTMENT_TYPES, DOCUMENT_STATES, selfApproved } from "@/lib/inventory";
import { lastSeen } from "@/lib/customer-form";
import { hasPermission } from "@/lib/dashboard-nav";
import { formatMoney } from "@/lib/format";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Stock adjustments — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const TABS = [
  { value: "PENDING_APPROVAL", label: "Waiting" },
  { value: "COMPLETED", label: "Posted" },
  { value: "REJECTED", label: "Rejected" },
  { value: "", label: "All" },
];

/**
 * Stock changes nobody bought, sold, made, moved or wasted — and so the ones
 * that need a second pair of eyes. Opens on what is waiting.
 */
export default async function StockAdjustmentsPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/stock-adjustments"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "stock_adjustments.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const status = TABS.some((tab) => tab.value && tab.value === one(params.status)) ? one(params.status) : one(params.status) === "" ? "" : "PENDING_APPROVAL";
  const cursor = one(params.cursor) || undefined;

  const scope = branchScope(principal, "stock_adjustments.read");
  const [branches, creatable, { currency }] = await Promise.all([
    scopedBranches(principal, "stock_adjustments.read"),
    actionableLocations(principal, "stock_adjustments.create"),
    getSiteIdentity(),
  ]);
  const branch = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : "";
  const type = ADJUSTMENT_TYPES.some((entry) => entry.value === one(params.type)) ? one(params.type) : "";
  const filters = { ...(branch ? { branchId: branch } : {}), ...(type ? { type } : {}) };

  const [counts, page] = await Promise.all([
    adjustmentCounts({ scope, ...filters }),
    listAdjustments({ ...(status ? { status } : {}), ...filters, scope, limit: PAGE_SIZE, cursor }).catch((error) => {
      if (cursor) return listAdjustments({ ...(status ? { status } : {}), ...filters, scope, limit: PAGE_SIZE });
      throw error;
    }),
  ]);
  const adjustments = serialize(page.items);
  const names = await userNames(adjustments.flatMap((row) => [row.createdById, row.approvedById]));
  const multiBranch = branches.length > 1;

  const href = (extra = {}) => {
    const search = new URLSearchParams();
    const values = { status, branch, type, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) search.set(key, String(value));
    if (values.status === "") search.set("status", "");
    const query = search.toString();
    return query ? `/dashboard/stock-adjustments?${query}` : "/dashboard/stock-adjustments";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Adjustments"
        description="Stock added or removed with no delivery, sale, transfer or waste behind it — opening stock, a found box, a correction. Each waits for approval before it moves anything."
        actions={
          creatable.length ? (
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/stock-adjustments/new?type=OPENING_STOCK" className="inline-flex items-center gap-2 rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                Opening stock
              </Link>
              <Link href="/dashboard/stock-adjustments/new" className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                <Plus aria-hidden="true" className="size-4" />
                New adjustment
              </Link>
            </div>
          ) : null
        }
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by state">
        {TABS.map((tab) => {
          const active = tab.value === status;
          const count = tab.value ? counts[tab.value] ?? 0 : Object.values(counts).reduce((sum, value) => sum + value, 0);
          return (
            <Link
              key={tab.label}
              href={href({ status: tab.value, cursor: "" })}
              aria-current={active ? "page" : undefined}
              className={`rounded-field px-4 py-2.5 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${active ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
            >
              {tab.label}
              <span className="ml-2 font-normal tabular-nums opacity-80">{count}</span>
            </Link>
          );
        })}
      </div>

      <ListFilters
        id="adjustments"
        hidden={{ status: status || null }}
        fields={[
          { type: "select", name: "type", label: "Kind", value: type, options: [{ value: "", label: "Every kind" }, ...ADJUSTMENT_TYPES.map((entry) => ({ value: entry.value, label: entry.label }))] },
          ...(multiBranch ? [{ type: "select", name: "branch", label: "Branch", value: branch, options: [{ value: "", label: "All branches" }, ...branches.map((row) => ({ value: row.id, label: row.name }))] }] : []),
        ]}
      />

      {adjustments.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {adjustments.map((adjustment) => {
              const state = DOCUMENT_STATES[adjustment.status] ?? DOCUMENT_STATES.DRAFT;
              const value = Number(adjustment.totalValue);
              return (
                <li key={adjustment.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/stock-adjustments/${adjustment.id}`} className="font-mono text-label-bold text-on-surface hover:underline">{adjustment.adjustmentNumber}</Link>
                      <Chip tone={state.tone}>{state.label}</Chip>
                      {adjustment.type === "OPENING_STOCK" ? <Chip tone="bg-tertiary-container text-on-tertiary-container">Opening stock</Chip> : null}
                      {adjustment.status === "COMPLETED" && selfApproved(adjustment.createdById, adjustment.approvedById) ? <Chip>Self-approved</Chip> : null}
                    </p>
                    <p className="mt-1 text-body-md text-on-surface">{adjustment.reason}</p>
                    <p className="text-body-md text-on-surface-variant">
                      {adjustment.location.name}
                      {` · ${adjustment.items.length} ${adjustment.items.length === 1 ? "item" : "items"}`}
                      {names[adjustment.createdById] ? ` · by ${names[adjustment.createdById]}` : ""}
                      {` · ${lastSeen(adjustment.createdAt).toLowerCase()}`}
                    </p>
                  </div>
                  <p className={`tabular-nums text-label-bold ${value < 0 ? "text-error" : "text-on-surface"}`}>
                    {value > 0 ? "+" : ""}
                    {formatMoney(adjustment.totalValue, currency)}
                  </p>
                </li>
              );
            })}
          </ul>
          {cursor || page.nextCursor ? (
            <div className="flex flex-wrap gap-2">
              {cursor ? <Link href={href({ cursor: "" })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">Newest</Link> : null}
              {page.nextCursor ? <Link href={href({ cursor: page.nextCursor })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">Older</Link> : null}
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState icon={PencilRuler} title={status === "PENDING_APPROVAL" ? "Nothing waiting" : "No adjustments here"} action={creatable.length && status === "PENDING_APPROVAL" ? { href: "/dashboard/stock-adjustments/new", label: "Raise an adjustment" } : null}>
          {status === "PENDING_APPROVAL" ? "Every adjustment has been decided." : "Try another tab."}
        </EmptyState>
      )}
    </div>
  );
}
