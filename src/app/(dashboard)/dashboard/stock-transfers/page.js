import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Plus, Truck } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { actionableLocations, scopedBranches } from "@/server/content/inventory-admin";
import { listTransfers, transferStageCounts } from "@/server/services/stock-transfer.service";
import { TRANSFER_STAGES, transferStage } from "@/lib/inventory";
import { lastSeen } from "@/lib/customer-form";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Stock transfers — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/**
 * Stock moving between locations and branches, by where it is in the journey.
 * Opens on what is on the way, because that is the stock that is in neither
 * place and someone is waiting for.
 */
export default async function StockTransfersPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/stock-transfers"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "stock_transfers.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const scope = branchScope(principal, "stock_transfers.read");
  const counts = await transferStageCounts({ scope });
  const requested = one(params.stage);
  const stage = TRANSFER_STAGES.some((row) => row.value === requested) ? requested : requested === "" ? "" : counts.IN_TRANSIT ? "IN_TRANSIT" : counts.DRAFT ? "DRAFT" : "";
  const cursor = one(params.cursor) || undefined;

  const [branches, sources] = await Promise.all([
    scopedBranches(principal, "stock_transfers.read"),
    actionableLocations(principal, "stock_transfers.create"),
  ]);
  const branch = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : "";

  const page = await listTransfers({ ...(stage ? { stage } : {}), ...(branch ? { branchId: branch } : {}), scope, limit: PAGE_SIZE, cursor }).catch((error) => {
    if (cursor) return listTransfers({ scope, limit: PAGE_SIZE });
    throw error;
  });
  const transfers = serialize(page.items);
  const tabs = [...TRANSFER_STAGES, { value: "", label: "All" }];

  const href = (extra = {}) => {
    const search = new URLSearchParams();
    const values = { stage, branch, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) search.set(key, String(value));
    if (values.stage === "") search.set("stage", "");
    const query = search.toString();
    return query ? `/dashboard/stock-transfers?${query}` : "/dashboard/stock-transfers";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Transfers"
        description="Stock sent from one location to another — between store rooms, or to another branch. It leaves when dispatched and arrives when the other end receives it."
        actions={
          sources.length ? (
            <Link href="/dashboard/stock-transfers/new" className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <Plus aria-hidden="true" className="size-4" />
              New transfer
            </Link>
          ) : null
        }
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by stage">
        {tabs.map((tab) => {
          const active = tab.value === stage;
          const count = tab.value ? counts[tab.value] ?? 0 : Object.values(counts).reduce((sum, value) => sum + value, 0);
          return (
            <Link
              key={tab.label}
              href={href({ stage: tab.value, cursor: "" })}
              aria-current={active ? "page" : undefined}
              className={`rounded-field px-4 py-2.5 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${active ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
            >
              {tab.label}
              <span className="ml-2 font-normal tabular-nums opacity-80">{count}</span>
            </Link>
          );
        })}
      </div>

      {branches.length > 1 ? (
        <ListFilters id="transfers" hidden={{ stage: stage || null }} fields={[{ type: "select", name: "branch", label: "Branch (either end)", value: branch, options: [{ value: "", label: "All branches" }, ...branches.map((row) => ({ value: row.id, label: row.name }))] }]} />
      ) : null}

      {transfers.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {transfers.map((transfer) => {
              const current = transferStage(transfer);
              const between = transfer.fromLocation.branchId !== transfer.toLocation.branchId;
              return (
                <li key={transfer.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/stock-transfers/${transfer.id}`} className="font-mono text-label-bold text-on-surface hover:underline">{transfer.transferNumber}</Link>
                      <Chip tone={current.tone}>{current.label}</Chip>
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-body-md text-on-surface">
                      {transfer.fromLocation.name}{between ? ` (${transfer.fromLocation.branch.name})` : ""}
                      <ArrowRight aria-label="to" className="size-4 text-on-surface-variant" />
                      {transfer.toLocation.name}{between ? ` (${transfer.toLocation.branch.name})` : ""}
                    </p>
                    <p className="text-body-md text-on-surface-variant">
                      {transfer.items.length} {transfer.items.length === 1 ? "item" : "items"}
                      {transfer.receivedAt
                        ? ` · arrived ${lastSeen(transfer.receivedAt).toLowerCase()}`
                        : transfer.dispatchedAt
                          ? ` · left ${lastSeen(transfer.dispatchedAt).toLowerCase()}`
                          : ` · created ${lastSeen(transfer.createdAt).toLowerCase()}`}
                    </p>
                  </div>
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
        <EmptyState icon={Truck} title={stage === "IN_TRANSIT" ? "Nothing on the way" : "No transfers here"} action={sources.length ? { href: "/dashboard/stock-transfers/new", label: "Send some stock" } : null}>
          {stage ? "Try another tab." : "Move stock between store rooms, or send it to another branch."}
        </EmptyState>
      )}
    </div>
  );
}
