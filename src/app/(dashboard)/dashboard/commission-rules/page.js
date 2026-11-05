import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Scale } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys, holdsCompanyWide } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listRules } from "@/server/services/creator-commission.service";
import { branchNames, ruleCounts } from "@/server/content/creator-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { dateLabel } from "@/lib/finance";
import {
  budgetUse,
  chipClass,
  conditionList,
  reachSummary,
  rewardSummary,
  ruleState,
  specificityLabel,
} from "@/lib/creator";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Commission rules — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * What a creator gets paid, and when.
 *
 * Listed in the order the engine resolves them — priority first, then
 * specificity — because "why did my rule not apply" is almost always that
 * another one outranked it, and a list sorted by name hides exactly that.
 *
 * Every row carries its budget and its reach, since those are the two ways a
 * rule costs more than whoever wrote it expected.
 */
export default async function CommissionRulesPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/commission-rules"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "creator_commission_rules.read")) redirect("/dashboard");

  const [page, counts, { currency, timeZone }] = await Promise.all([
    listRules({ scope: branchScope(principal, "creator_commission_rules.read"), limit: 100 }),
    ruleCounts(principal),
    getSiteIdentity(),
  ]);

  const rules = serialize(page.items);
  const names = await branchNames(rules.map((rule) => rule.branchIds));
  const canCreate = hasPermission(permissions, "creator_commission_rules.create");
  const now = new Date();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Commission rules"
        description="Exactly one rule pays per attributed sale — they are never stacked. The highest priority wins, then the more specific rule, then the most recent."
        actions={
          canCreate ? (
            <Link
              href="/dashboard/commission-rules/new"
              className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Plus aria-hidden="true" className="size-4" />
              New rule
            </Link>
          ) : null
        }
      />

      {canCreate && !holdsCompanyWide(principal, "creator_commission_rules.create") ? (
        <p className="rounded-card bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant">
          Your permission is pinned to a branch, so you can write rules for your own outlets. A rule with no branches
          named pays out at every outlet, now and any opened later, and needs a company-wide role.
        </p>
      ) : null}

      <p className="text-body-md text-on-surface-variant">
        {counts.active} of {counts.all} {counts.all === 1 ? "rule" : "rules"} switched on.
      </p>

      {rules.length ? (
        <ul className="flex flex-col gap-3">
          {rules.map((rule) => {
            const state = ruleState(rule, now);
            const reach = reachSummary(rule, names);
            const budget = budgetUse(rule);
            const conditions = conditionList(rule, { formatMoney: (value) => formatMoney(value, currency) });

            return (
              <li key={rule.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/dashboard/commission-rules/${rule.id}`}
                      className="text-label-bold text-on-surface hover:underline"
                    >
                      {rule.name}
                    </Link>
                    <Chip tone={chipClass(state.tone)}>{state.label}</Chip>
                    <Chip tone={chipClass(reach.tone)}>{reach.label}</Chip>
                  </p>
                  <p className="mt-1 text-body-md text-on-surface">
                    {rewardSummary(rule, { formatMoney: (value) => formatMoney(value, currency) })}
                  </p>
                  <p className="text-body-md text-on-surface-variant">
                    Priority {rule.priority} · {specificityLabel(rule)}
                    {conditions.length ? ` · when ${conditions.join(" and ")}` : " · always"}
                  </p>
                  {rule.startsAt || rule.endsAt ? (
                    <p className="text-body-md text-on-surface-variant">
                      {rule.startsAt ? `From ${dateLabel(rule.startsAt, timeZone)}` : "No start date"}
                      {rule.endsAt ? ` until ${dateLabel(rule.endsAt, timeZone)}` : ""}
                    </p>
                  ) : null}
                  {reach.note ? <p className="mt-1 text-body-md text-error">{reach.note}</p> : null}
                </div>
                <div className="text-right">
                  {budget ? (
                    <>
                      <p className="tabular-nums text-body-md text-on-surface">
                        {formatMoney(budget.spent, currency)} / {formatMoney(budget.total, currency)}
                      </p>
                      <p className="text-label-bold font-normal text-on-surface-variant">
                        {budget.exhausted ? "budget spent" : `${budget.percent.toFixed(0)}% of budget`}
                      </p>
                    </>
                  ) : (
                    <p className="text-label-bold font-normal text-on-surface-variant">No budget cap</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          icon={Scale}
          title="No rules yet"
          action={canCreate ? { href: "/dashboard/commission-rules/new", label: "Write one" } : null}
        >
          Without a rule, an attributed sale still records — it just pays nothing, and the creator is told the sale
          happened but missed the threshold.
        </EmptyState>
      )}
    </div>
  );
}
