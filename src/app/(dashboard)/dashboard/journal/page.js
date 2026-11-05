import Link from "next/link";
import { redirect } from "next/navigation";
import { BookMarked, Plus } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listJournalEntries } from "@/server/services/journal.service";
import { branchNames, journalCounts, scopedBranches } from "@/server/content/finance-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { JOURNAL_SOURCES, JOURNAL_STATES, dateLabel, sourceLabel } from "@/lib/finance";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Journal — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

const TABS = [
  { value: "", label: "All" },
  { value: "DRAFT", label: "Drafts" },
  { value: "POSTED", label: "Posted" },
  { value: "VOID", label: "Void" },
];

/**
 * Every entry in the ledger.
 *
 * Almost all of them are written by the system as a consequence of something
 * real, so the source is on every row: "4,210 Dr Inventory" means nothing on
 * its own, and "from goods receipt GRN-0031" means everything. The source
 * filter is how a question like "why did inventory move last Tuesday" gets
 * answered without reading a thousand lines.
 */
export default async function JournalPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/journal"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "journal_entries.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const scope = branchScope(principal, "journal_entries.read");

  const [counts, branches, { currency }] = await Promise.all([
    journalCounts(principal),
    scopedBranches(principal, "journal_entries.read"),
    getSiteIdentity(),
  ]);

  const requested = one(params.status);
  const status = TABS.some((row) => row.value === requested) ? requested : "";
  const source = JOURNAL_SOURCES[one(params.source)] ? one(params.source) : "";
  const branch = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : "";
  const from = one(params.from) ?? "";
  const to = one(params.to) ?? "";
  const cursor = one(params.cursor) || undefined;

  const page = await listJournalEntries({
    ...(status ? { status } : {}),
    ...(source ? { source } : {}),
    ...(branch ? { branchId: branch } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    scope,
    limit: PAGE_SIZE,
    cursor,
  }).catch((error) => {
    if (cursor) return listJournalEntries({ scope, limit: PAGE_SIZE });
    throw error;
  });

  const entries = serialize(page.items);
  const names = await branchNames(entries.map((row) => row.branchId));
  const canCreate = hasPermission(permissions, "journal_entries.create");

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { status, source, branch, from, to, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    const text = query.toString();
    return text ? `/dashboard/journal?${text}` : "/dashboard/journal";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Journal"
        description="The ledger itself. Nearly every entry is written automatically by whatever caused it, and each one says what that was."
        actions={
          canCreate ? (
            <Link
              href="/dashboard/journal/new"
              className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Plus aria-hidden="true" className="size-4" />
              Write an entry
            </Link>
          ) : null
        }
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by state">
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
        id="journal"
        hidden={{ status: status || null }}
        fields={[
          {
            type: "select",
            name: "source",
            label: "Caused by",
            value: source,
            options: [{ value: "", label: "Anything" }, ...Object.entries(JOURNAL_SOURCES).map(([value, label]) => ({ value, label }))],
          },
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
          { type: "date", name: "from", label: "From", value: from },
          { type: "date", name: "to", label: "To", value: to },
        ]}
      />

      {entries.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {entries.map((entry) => {
              const state = JOURNAL_STATES[entry.status] ?? { label: entry.status, tone: "" };
              return (
                <li key={entry.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/journal/${entry.id}`} className="font-mono text-label-bold text-on-surface hover:underline">
                        {entry.entryNumber}
                      </Link>
                      <Chip tone={state.tone}>{state.label}</Chip>
                      <Chip>{sourceLabel(entry.source)}</Chip>
                      {entry.reversalOfId ? <Chip tone="bg-warning-container text-on-warning-container">A reversal</Chip> : null}
                    </p>
                    <p className="mt-1 text-body-md text-on-surface">{entry.memo ?? "No memo"}</p>
                    <p className="text-body-md text-on-surface-variant">
                      {dateLabel(entry.entryDate)}
                      {entry.branchId ? ` · ${names[entry.branchId] ?? "Another branch"}` : " · the company"}
                      {entry.period ? ` · ${entry.period.name}` : ""}
                      {" · "}
                      {entry.lineCount} {entry.lineCount === 1 ? "line" : "lines"}
                    </p>
                  </div>
                  <p className="tabular-nums text-body-md text-on-surface">{formatMoney(entry.totalDebit, currency)}</p>
                </li>
              );
            })}
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
        <EmptyState icon={BookMarked} title={status || source ? "Nothing matches" : "The ledger is empty"}>
          {status || source
            ? "Try a wider filter."
            : "Entries appear as the business does things — an order paid for, a delivery received, a wage run approved."}
        </EmptyState>
      )}
    </div>
  );
}
