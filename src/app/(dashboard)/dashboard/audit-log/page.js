import Link from "next/link";
import { redirect } from "next/navigation";
import { ScrollText } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listAuditActions, listAuditLogs } from "@/server/services/audit.service";
import { auditActors, auditDepth, auditEntityTypes, scopedBranches } from "@/server/content/insights-admin";
import { getSiteIdentity } from "@/server/content/site";
import { actionGroups, actionSentence, actorName, changeLines, dateLabel, isWeighty, timeLabel } from "@/lib/insights";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Audit log — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

/**
 * Who did what, and when.
 *
 * Two decisions shape this page.
 *
 * **It says how far back it goes.** An audit trail that starts three weeks
 * ago cannot answer a question about last quarter, and a reader who does not
 * know that will conclude nothing happened rather than that nothing was
 * kept. The depth is stated above the list, not discovered by paging to the
 * end.
 *
 * **The irreversible actions are marked, and nothing else is.** Deletions,
 * voids, reversals, refunds and approvals get a mark; the other forty-odd
 * action types do not. A log where everything is ranked by severity is a log
 * nobody reads, and the point of this screen is that the eye lands on the
 * entry that cost somebody money.
 *
 * Read-only, with no way to delete a row from anywhere in the product. A
 * trail somebody can edit is not a trail.
 */
export default async function AuditLogPage({ searchParams }) {
  const { timeZone } = await getSiteIdentity();
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/audit-log"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "audit_logs.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const scope = branchScope(principal, "audit_logs.read");

  const [actions, actors, entityTypes, branches, depth] = await Promise.all([
    listAuditActions({ scope }),
    auditActors(principal),
    auditEntityTypes(principal),
    scopedBranches(principal, "audit_logs.read"),
    auditDepth(principal),
  ]);

  const groups = actionGroups(actions);
  const area = groups.some((row) => row.key === one(params.area)) ? one(params.area) : "";
  const action = actions.includes(one(params.action)) ? one(params.action) : "";
  const actorId = actors.some((row) => row.id === one(params.actor)) ? one(params.actor) : "";
  const entityType = entityTypes.includes(one(params.entity)) ? one(params.entity) : "";
  const branch = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : "";
  const search = (one(params.q) ?? "").trim();
  const from = one(params.from) ?? "";
  const to = one(params.to) ?? "";
  const cursor = one(params.cursor) || undefined;

  const filters = {
    // An area is a prefix match — "order." covers every order action — which
    // is how a question like "what happened to orders yesterday" is asked.
    ...(action ? { action } : area ? { action: `${area}.` } : {}),
    ...(actorId ? { actorId } : {}),
    ...(entityType ? { entityType } : {}),
    ...(branch ? { branchId: branch } : {}),
    ...(search ? { search } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    scope,
  };

  const page = await listAuditLogs({ ...filters, limit: PAGE_SIZE, cursor }).catch((error) => {
    if (cursor) return listAuditLogs({ ...filters, limit: PAGE_SIZE });
    throw error;
  });
  const logs = serialize(page.items);

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { area, action, actor: actorId, entity: entityType, branch, q: search, from, to, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    const text = query.toString();
    return text ? `/dashboard/audit-log?${text}` : "/dashboard/audit-log";
  };

  const filtered = Boolean(area || action || actorId || entityType || branch || search || from || to);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit log"
        description="Every recorded change, in the order it happened. Nothing on this screen can edit or remove an entry — a trail somebody can tidy up is not a trail."
      />

      <p className="text-body-md text-on-surface-variant">
        {depth.total.toLocaleString()} {depth.total === 1 ? "entry" : "entries"}
        {depth.oldest ? ` · the record starts ${dateLabel(depth.oldest, timeZone)}` : ""}
        {depth.newest ? ` · last activity ${timeLabel(depth.newest)}` : ""}
        {". Anything before that was not kept, which is not the same as nothing having happened."}
      </p>

      {groups.length ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by area">
          <Link
            href={href({ area: "", action: "", cursor: "" })}
            aria-current={!area && !action ? "page" : undefined}
            className={`rounded-field px-4 py-2.5 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${!area && !action ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
          >
            Everything
          </Link>
          {groups.map((group) => (
            <Link
              key={group.key}
              href={href({ area: group.key, action: "", cursor: "" })}
              aria-current={area === group.key ? "page" : undefined}
              className={`rounded-field px-4 py-2.5 text-label-bold capitalize focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${area === group.key ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
            >
              {group.label}
            </Link>
          ))}
        </div>
      ) : null}

      <ListFilters
        id="audit"
        hidden={{ area: area || null }}
        fields={[
          { type: "search", name: "q", label: "Find", value: search, placeholder: "An action, a record type, or an id" },
          ...(actors.length > 1
            ? [
                {
                  type: "select",
                  name: "actor",
                  label: "Who",
                  value: actorId,
                  options: [{ value: "", label: "Anyone" }, ...actors.map((row) => ({ value: row.id, label: row.name ?? row.email }))],
                },
              ]
            : []),
          ...(entityTypes.length > 1
            ? [
                {
                  type: "select",
                  name: "entity",
                  label: "Record type",
                  value: entityType,
                  options: [{ value: "", label: "Any record" }, ...entityTypes.map((row) => ({ value: row, label: row }))],
                },
              ]
            : []),
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

      {logs.length ? (
        <>
          <ul className="flex flex-col gap-2">
            {logs.map((log) => {
              const weighty = isWeighty(log.action);
              const changes = changeLines(log.changes);

              return (
                <li
                  key={log.id}
                  className={`flex flex-col gap-2 rounded-card p-4 ${weighty ? "bg-error-container/30" : "bg-surface-container-lowest"}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-body-md text-on-surface">
                        <span className="text-label-bold">{actorName(log)}</span> {actionSentence(log.action)}
                        {log.entityId ? <span className="font-mono text-on-surface-variant"> {log.entityId.slice(-8)}</span> : null}
                      </p>
                      <p className="text-label-bold font-normal text-on-surface-variant">
                        <span className="font-mono">{log.action}</span>
                        {log.branch ? ` · ${log.branch.name}` : " · company-wide"}
                        {log.ipAddress ? ` · ${log.ipAddress}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {weighty ? <Chip tone="bg-error-container text-on-error-container">Cannot be undone</Chip> : null}
                      <time dateTime={log.createdAt} className="text-label-bold font-normal text-on-surface-variant">
                        {timeLabel(log.createdAt)}
                      </time>
                    </div>
                  </div>

                  {changes.length ? (
                    // A native disclosure: no JavaScript, works before hydration,
                    // and keyboard-operable without any of it being written.
                    <details className="group">
                      <summary className="w-fit cursor-pointer rounded-field px-2 py-1 text-label-bold text-on-surface-variant hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                        What changed ({changes.length})
                      </summary>
                      <dl className="mt-2 grid gap-x-6 gap-y-1 rounded-field bg-surface-container-low p-3 sm:grid-cols-2">
                        {changes.map((change) => (
                          <div key={change.field} className="min-w-0">
                            <dt className="text-label-bold capitalize text-on-surface-variant">{change.field}</dt>
                            <dd className="break-words text-body-md text-on-surface">{change.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  ) : null}
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
        <EmptyState icon={ScrollText} title={filtered ? "Nothing matches" : "Nothing recorded yet"}>
          {filtered
            ? "Try a wider range, or clear a filter."
            : "Entries appear as people change things. An empty log on a working system usually means the trail was cleared."}
        </EmptyState>
      )}
    </div>
  );
}
