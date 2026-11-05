import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import StartCountForm from "@/components/dashboard/inventory/StartCountForm";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getSiteIdentity } from "@/server/content/site";
import { actionableLocations, categoryOptions, userNames } from "@/server/content/inventory-admin";
import { countCounts, listCounts } from "@/server/services/stock-count.service";
import { COUNT_STATES, selfApproved } from "@/lib/inventory";
import { lastSeen } from "@/lib/customer-form";
import { hasPermission } from "@/lib/dashboard-nav";
import { formatMoney } from "@/lib/format";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Stock counts — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const TABS = [
  { value: "DRAFT", label: "Counting" },
  { value: "PENDING_APPROVAL", label: "Waiting to post" },
  { value: "COMPLETED", label: "Posted" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "", label: "All" },
];

/**
 * Physical counts: someone looks at the shelf, and the system is corrected to
 * match. The control that makes every other stock number trustworthy.
 */
export default async function StockCountsPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/stock-counts"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "stock_counts.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const scope = branchScope(principal, "stock_counts.read");
  const counts = await countCounts({ scope });
  const requested = one(params.status);
  const status = TABS.some((tab) => tab.value && tab.value === requested)
    ? requested
    : requested === ""
      ? ""
      : counts.PENDING_APPROVAL
        ? "PENDING_APPROVAL"
        : counts.DRAFT
          ? "DRAFT"
          : "";
  const cursor = one(params.cursor) || undefined;

  const [startable, categories, { currency }, page] = await Promise.all([
    actionableLocations(principal, "stock_counts.create"),
    categoryOptions(),
    getSiteIdentity(),
    listCounts({ ...(status ? { status } : {}), scope, limit: PAGE_SIZE, cursor }).catch((error) => {
      if (cursor) return listCounts({ scope, limit: PAGE_SIZE });
      throw error;
    }),
  ]);
  const sheets = serialize(page.items);
  const names = await userNames(sheets.flatMap((row) => [row.countedById, row.approvedById]));

  const href = (extra = {}) => {
    const search = new URLSearchParams();
    const values = { status, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) search.set(key, String(value));
    if (values.status === "") search.set("status", "");
    const query = search.toString();
    return query ? `/dashboard/stock-counts?${query}` : "/dashboard/stock-counts";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Stock counts"
        description="Count what is really on the shelf. The counter enters numbers blind; a manager then sees the difference from the system and posts the correction."
      />

      {startable.length ? <StartCountForm locations={serialize(startable)} categories={categories.filter((row) => row.isActive)} /> : null}

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

      {sheets.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {sheets.map((sheet) => {
              const state = COUNT_STATES[sheet.status] ?? COUNT_STATES.DRAFT;
              const decided = sheet.status === "COMPLETED" || sheet.status === "PENDING_APPROVAL";
              const value = Number(sheet.varianceValue);
              return (
                <li key={sheet.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/stock-counts/${sheet.id}`} className="font-mono text-label-bold text-on-surface hover:underline">{sheet.countNumber}</Link>
                      <Chip tone={state.tone}>{state.label}</Chip>
                      {sheet.status === "COMPLETED" && selfApproved(sheet.countedById, sheet.approvedById) ? <Chip>Self-approved</Chip> : null}
                    </p>
                    <p className="mt-1 text-body-md text-on-surface">
                      {sheet.location.name}
                      {sheet.scope ? ` · ${sheet.scope}` : ""}
                    </p>
                    <p className="text-body-md text-on-surface-variant">
                      {sheet.lineCount} {sheet.lineCount === 1 ? "item" : "items"}
                      {names[sheet.countedById] ? ` · ${names[sheet.countedById]}` : ""}
                      {` · started ${lastSeen(sheet.startedAt).toLowerCase()}`}
                    </p>
                  </div>
                  {decided ? (
                    <p className={`tabular-nums text-label-bold ${value < 0 ? "text-error" : "text-on-surface"}`}>
                      {value > 0 ? "+" : ""}
                      {formatMoney(sheet.varianceValue, currency)}
                      <span className="block text-right font-normal text-on-surface-variant">difference</span>
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
        <EmptyState icon={ClipboardCheck} title={status === "PENDING_APPROVAL" ? "Nothing waiting to post" : "No counts here"}>
          {status ? "Try another tab." : "Start a count above when someone is ready to walk the shelves."}
        </EmptyState>
      )}
    </div>
  );
}
