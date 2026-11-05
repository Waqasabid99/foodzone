import Link from "next/link";
import { redirect } from "next/navigation";
import { Factory, Plus } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getSiteIdentity } from "@/server/content/site";
import { actionableLocations, scopedBranches } from "@/server/content/inventory-admin";
import { listProductionOrders, productionCounts } from "@/server/services/production-order.service";
import { productionCostVisible } from "@/server/inventory/access";
import { formatQuantity } from "@/lib/inventory";
import { PRODUCTION_STATES, PRODUCTION_TABS } from "@/lib/production";
import { lastSeen } from "@/lib/customer-form";
import { hasPermission } from "@/lib/dashboard-nav";
import { formatMoney } from "@/lib/format";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Production — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/**
 * Batches the kitchen makes for stock — sauces, doughs, stocks. Opens on what
 * is on the bench, or on what is planned when nothing is.
 */
export default async function ProductionPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/production"));
  if (!hasPermission(grantedPermissionKeys(principal), "production_orders.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const cursor = one(params.cursor) || undefined;
  const scope = branchScope(principal, "production_orders.read");

  const [branches, plannable, { currency }] = await Promise.all([
    scopedBranches(principal, "production_orders.read"),
    actionableLocations(principal, "production_orders.create"),
    getSiteIdentity(),
  ]);
  const branch = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : "";
  const counts = await productionCounts({ scope, ...(branch ? { branchId: branch } : {}) });

  const requested = one(params.status);
  const status = PRODUCTION_TABS.some((tab) => tab.value && tab.value === requested)
    ? requested
    : requested === ""
      ? ""
      : counts.IN_PROGRESS
        ? "IN_PROGRESS"
        : counts.PLANNED
          ? "PLANNED"
          // Nothing open: show everything rather than an empty tab.
          : Object.values(counts).some(Boolean)
            ? ""
            : "PLANNED";

  const query = { ...(status ? { status } : {}), ...(branch ? { branchId: branch } : {}), scope, limit: PAGE_SIZE };
  const page = await listProductionOrders({ ...query, cursor }).catch((error) => {
    if (cursor) return listProductionOrders(query);
    throw error;
  });
  const runs = serialize(page.items);
  const multiBranch = branches.length > 1;

  const href = (extra = {}) => {
    const search = new URLSearchParams();
    const values = { status, branch, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) search.set(key, String(value));
    if (values.status === "") search.set("status", "");
    const text = search.toString();
    return text ? `/dashboard/production?${text}` : "/dashboard/production";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Production"
        description="Batches made for stock — sauces, doughs, stocks. Ingredients leave the shelf when a batch starts; what it makes goes into stock when it is finished, at what it really cost."
        actions={
          plannable.length ? (
            <Link href="/dashboard/production/new" className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <Plus aria-hidden="true" className="size-4" />
              Plan a batch
            </Link>
          ) : null
        }
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by state">
        {PRODUCTION_TABS.map((tab) => {
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

      {multiBranch ? (
        <ListFilters id="production" hidden={{ status: status || null }} fields={[{ type: "select", name: "branch", label: "Branch", value: branch, options: [{ value: "", label: "All branches" }, ...branches.map((row) => ({ value: row.id, label: row.name }))] }]} />
      ) : null}

      {runs.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {runs.map((run) => {
              const state = PRODUCTION_STATES[run.status] ?? PRODUCTION_STATES.PLANNED;
              const unit = run.recipe.yieldUom;
              const qty = (value) => formatQuantity(value, { precision: unit.precision, unit: unit.code });
              const showCost = productionCostVisible(principal, run.branchId) && run.status === "COMPLETED";
              const over = showCost ? Number(run.costVariance?.variance ?? 0) : 0;
              return (
                <li key={run.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/production/${run.id}`} className="font-mono text-label-bold text-on-surface hover:underline">{run.productionNumber}</Link>
                      <Chip tone={state.tone}>{state.label}</Chip>
                    </p>
                    <p className="mt-1 text-body-md text-on-surface">
                      {run.status === "COMPLETED" ? `${qty(run.producedQuantity)} of ${run.recipe.outputItem?.name}` : `${qty(run.plannedQuantity)} of ${run.recipe.outputItem?.name}`}
                      {run.status === "COMPLETED" && Number(run.wastedQuantity) > 0 ? <span className="text-on-surface-variant"> · {qty(run.wastedQuantity)} lost</span> : null}
                    </p>
                    <p className="text-body-md text-on-surface-variant">
                      {run.location.name}
                      {multiBranch ? ` — ${run.location.branch.name}` : ""}
                      {` · ${run.recipe.name} v${run.recipe.version}`}
                      {run.completedAt
                        ? ` · finished ${lastSeen(run.completedAt).toLowerCase()}`
                        : run.startedAt
                          ? ` · started ${lastSeen(run.startedAt).toLowerCase()}`
                          : run.scheduledFor
                            ? ` · for ${new Date(run.scheduledFor).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
                            : ` · planned ${lastSeen(run.createdAt).toLowerCase()}`}
                    </p>
                  </div>
                  {showCost ? (
                    <p className="text-right text-body-md">
                      <span className="block tabular-nums text-label-bold text-on-surface">{formatMoney(run.totalCost, currency)}</span>
                      <span className={over > 0 ? "text-error" : "text-on-surface-variant"}>
                        {over > 0 ? `${formatMoney(over, currency)} over` : over < 0 ? `${formatMoney(-over, currency)} under` : "on target"}
                      </span>
                    </p>
                  ) : null}
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
        <EmptyState icon={Factory} title={status === "IN_PROGRESS" ? "Nothing on the bench" : status === "PLANNED" ? "Nothing planned" : "No batches here"} action={plannable.length ? { href: "/dashboard/production/new", label: "Plan a batch" } : null}>
          {status === "PLANNED" || status === "IN_PROGRESS" ? "Plan a batch of a prep recipe to make it for stock." : "Try another tab."}
        </EmptyState>
      )}
    </div>
  );
}
