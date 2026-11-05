import Link from "next/link";
import { redirect } from "next/navigation";
import { Calculator } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import StatTile from "@/components/dashboard/StatTile";
import OpenDrawer from "@/components/dashboard/finance/OpenDrawer";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listSessions } from "@/server/services/register.service";
import { branchNames, openDrawers, runningCash, scopedBranches, sessionCounts, userNames } from "@/server/content/finance-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { SESSION_STATES, cashVariance, timeLabel } from "@/lib/finance";
import { hasPermission } from "@/lib/dashboard-nav";
import { can } from "@/lib/api/permissions";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Registers — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

const TABS = [
  { value: "", label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "CLOSED", label: "Counted" },
  { value: "RECONCILED", label: "Signed off" },
];

/**
 * Cash drawers, shift by shift.
 *
 * The thing worth noticing here is a drawer that is still open from an
 * earlier day. The shift ended, nobody closed it, the next shift started
 * against the same drawer, and the two are no longer separable — so a
 * shortage can never be attributed to anybody. That is called out above the
 * list rather than being something you notice by reading dates.
 */
export default async function RegistersPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/registers"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "cash_registers.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const scope = branchScope(principal, "cash_registers.read");

  const [counts, branches, { currency }, open] = await Promise.all([
    sessionCounts(principal),
    scopedBranches(principal, "cash_registers.read"),
    getSiteIdentity(),
    openDrawers(principal),
  ]);

  // Anywhere in scope will do: the form names the branch when there is a
  // choice, and the endpoint checks the branch that is actually sent.
  const canOpen = branches.some((row) => can(principal, "cash_registers.open", { branchId: row.id }));

  const requested = one(params.status);
  const status = TABS.some((row) => row.value === requested) ? requested : "";
  const branch = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : "";
  const cursor = one(params.cursor) || undefined;

  const page = await listSessions({
    ...(status ? { status } : {}),
    ...(branch ? { branchId: branch } : {}),
    scope,
    limit: PAGE_SIZE,
    cursor,
  }).catch((error) => {
    if (cursor) return listSessions({ scope, limit: PAGE_SIZE });
    throw error;
  });

  const sessions = serialize(page.items);
  const names = await branchNames(sessions.map((row) => row.branchId));
  const people = await userNames(sessions.map((row) => row.openedById));
  // An open session has no `expectedCash` until it closes, so the running
  // total is derived for those rows rather than falling back to the float.
  const running = await runningCash(sessions.filter((row) => row.status === "OPEN").map((row) => row.id));

  // A drawer open since before today is the one that stops being attributable.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const stale = open.filter((row) => new Date(row.openedAt) < startOfToday);

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { status, branch, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    const text = query.toString();
    return text ? `/dashboard/registers?${text}` : "/dashboard/registers";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Cash registers"
        description="A session is one shift against one drawer: what it opened with, what moved through it, and what was actually in it at the end."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile label="Drawers open now" value={String(open.length)} note="Sessions still running." />
        {stale.length ? (
          <StatTile
            label="Open since before today"
            value={String(stale.length)}
            note="Nobody closed these. Any shortage can no longer be attributed to one shift."
            tone="inverse"
          />
        ) : null}
        {counts.CLOSED ? (
          <StatTile label="Counted, not signed off" value={String(counts.CLOSED)} note="Waiting for someone to accept the variance." />
        ) : null}
      </div>

      {canOpen ? <OpenDrawer branches={branches} /> : null}

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

      {branches.length > 1 ? (
        <ListFilters
          id="registers"
          hidden={{ status: status || null }}
          fields={[
            {
              type: "select",
              name: "branch",
              label: "Branch",
              value: branch,
              options: [{ value: "", label: "All branches" }, ...branches.map((row) => ({ value: row.id, label: row.name }))],
            },
          ]}
        />
      ) : null}

      {sessions.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {sessions.map((session) => {
              const state = SESSION_STATES[session.status] ?? { label: session.status, tone: "" };
              const variance = session.status === "OPEN" ? null : cashVariance({ expected: session.expectedCash, counted: session.countedCash });
              return (
                <li key={session.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/registers/${session.id}`} className="text-label-bold text-on-surface hover:underline">
                        {session.registerName}
                      </Link>
                      <Chip tone={state.tone}>{state.label}</Chip>
                    </p>
                    <p className="mt-1 text-body-md text-on-surface-variant">
                      {branches.length > 1 ? `${names[session.branchId] ?? "Another branch"} · ` : ""}
                      opened {timeLabel(session.openedAt)}
                      {people[session.openedById] ? ` by ${people[session.openedById]}` : ""}
                      {session.closedAt ? ` · closed ${timeLabel(session.closedAt)}` : ""}
                    </p>
                    <p className="text-body-md text-on-surface-variant">
                      {session.paymentCount} {session.paymentCount === 1 ? "payment" : "payments"} · {session.movementCount}{" "}
                      {session.movementCount === 1 ? "movement" : "movements"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tabular-nums text-body-md text-on-surface">
                      {formatMoney(session.countedCash ?? session.expectedCash ?? running[session.id] ?? session.openingFloat, currency)}
                    </p>
                    {variance?.known && variance.direction !== "square" ? (
                      <p className={`text-label-bold font-normal ${variance.tone}`}>
                        {variance.label} {formatMoney(variance.amount, currency)}
                      </p>
                    ) : variance?.known ? (
                      <p className="text-label-bold font-normal text-on-surface-variant">Agreed exactly</p>
                    ) : (
                      <p className="text-label-bold font-normal text-on-surface-variant">
                        {session.status === "OPEN" ? "Should be in the drawer" : "Not counted yet"}
                      </p>
                    )}
                  </div>
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
        <EmptyState icon={Calculator} title={status ? "Nothing in this state" : "No sessions yet"}>
          {status
          ? "Try another tab."
          : canOpen
            ? "Open one above to start a shift. If somebody takes cash before you do, a drawer is opened in their name so the money is still counted."
            : "A session opens when a cashier starts a shift against a drawer."}
        </EmptyState>
      )}
    </div>
  );
}
