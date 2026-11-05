import Link from "next/link";
import { redirect } from "next/navigation";
import { PackageCheck, Plus } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listGoodsReceipts } from "@/server/services/goods-receipt.service";
import { actionableLocations } from "@/server/content/inventory-admin";
import { goodsReceiptCounts, scopedBranches, supplierOptions } from "@/server/content/purchasing-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { GRN_STATES, dateLabel } from "@/lib/purchasing";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Goods receipts — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

const TABS = [
  { value: "DRAFT", label: "To post" },
  { value: "COMPLETED", label: "In stock" },
  { value: "CANCELLED", label: "Discarded" },
  { value: "", label: "All" },
];

/**
 * What has arrived.
 *
 * Opens on the drafts, because a draft receipt is a delivery that is sitting
 * in the store room and not on the books: the kitchen has the food, the
 * system does not know, and every stock figure is wrong until somebody posts
 * it.
 */
export default async function GoodsReceiptsPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/goods-receipts"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "goods_receipts.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const scope = branchScope(principal, "goods_receipts.read");

  const [counts, branches, suppliers, { currency, timeZone }, locations] = await Promise.all([
    goodsReceiptCounts(principal),
    scopedBranches(principal, "goods_receipts.read"),
    supplierOptions({ includeInactive: true }),
    getSiteIdentity(),
    actionableLocations(principal, "goods_receipts.create"),
  ]);

  const requested = one(params.status);
  const known = TABS.some((row) => row.value === requested);
  const status = known ? requested : counts.DRAFT ? "DRAFT" : "";
  const branch = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : "";
  const supplier = suppliers.some((row) => row.id === one(params.supplier)) ? one(params.supplier) : "";
  const cursor = one(params.cursor) || undefined;

  const page = await listGoodsReceipts({
    ...(status ? { status } : {}),
    ...(branch ? { branchId: branch } : {}),
    ...(supplier ? { supplierId: supplier } : {}),
    scope,
    limit: PAGE_SIZE,
    cursor,
  }).catch((error) => {
    if (cursor) return listGoodsReceipts({ scope, limit: PAGE_SIZE });
    throw error;
  });
  const receipts = serialize(page.items);
  const branchName = Object.fromEntries(branches.map((row) => [row.id, row.name]));

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { status, branch, supplier, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    if (values.status === "") query.set("status", "");
    const text = query.toString();
    return text ? `/dashboard/goods-receipts?${text}` : "/dashboard/goods-receipts";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Goods receipts"
        description="Deliveries, and whether they have been put on the books. A draft has arrived in the store room but not in the system, so every stock figure for those items is short until it is posted."
        actions={
          locations.length ? (
            <Link
              href="/dashboard/goods-receipts/new"
              className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Plus aria-hidden="true" className="size-4" />
              Receive a delivery
            </Link>
          ) : null
        }
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by stage">
        {TABS.map((tab) => {
          const active = tab.value === status;
          const count = tab.value ? (counts[tab.value] ?? 0) : Object.values(counts).reduce((sum, value) => sum + value, 0);
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
        id="goods-receipts"
        hidden={{ status: status || null }}
        fields={[
          ...(branches.length > 1
            ? [
                {
                  type: "select",
                  name: "branch",
                  label: "Branch",
                  value: branch,
                  options: [{ value: "", label: "All branches" }, ...branches.map((row) => ({ value: row.id, label: row.name }))],
                },
              ]
            : []),
          {
            type: "select",
            name: "supplier",
            label: "Supplier",
            value: supplier,
            options: [{ value: "", label: "All suppliers" }, ...suppliers.map((row) => ({ value: row.id, label: row.name }))],
          },
        ]}
      />

      {receipts.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {receipts.map((receipt) => (
              <li key={receipt.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link href={`/dashboard/goods-receipts/${receipt.id}`} className="font-mono text-label-bold text-on-surface hover:underline">
                      {receipt.grnNumber}
                    </Link>
                    <Chip tone={GRN_STATES[receipt.status]?.tone}>{GRN_STATES[receipt.status]?.label ?? receipt.status}</Chip>
                  </p>
                  <p className="mt-1 text-body-md text-on-surface">{receipt.supplier.name}</p>
                  <p className="text-body-md text-on-surface-variant">
                    {branches.length > 1 ? `${branchName[receipt.branchId] ?? "Another branch"} · ` : ""}
                    {receipt.lineCount} {receipt.lineCount === 1 ? "line" : "lines"} · arrived {dateLabel(receipt.receivedAt, timeZone)}
                    {receipt.purchaseOrder ? ` · against ${receipt.purchaseOrder.poNumber}` : " · no order"}
                  </p>
                </div>
                <p className="tabular-nums text-body-md text-on-surface">{formatMoney(receipt.grandTotal, currency)}</p>
              </li>
            ))}
          </ul>

          {cursor || page.nextCursor ? (
            <div className="flex flex-wrap gap-2">
              {cursor ? (
                <Link href={href({ cursor: "" })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">
                  Newest
                </Link>
              ) : null}
              {page.nextCursor ? (
                <Link href={href({ cursor: page.nextCursor })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">
                  Older
                </Link>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState
          icon={PackageCheck}
          title={status === "DRAFT" ? "Nothing waiting to be posted" : status ? "Nothing here" : "No deliveries recorded"}
          action={locations.length ? { href: "/dashboard/goods-receipts/new", label: "Record one" } : null}
        >
          {status ? "Try another tab." : "Recording a delivery is what puts food into stock and starts the clock on paying for it."}
        </EmptyState>
      )}
    </div>
  );
}
