import Link from "next/link";
import { nullIfMissing } from "@/lib/api/errors";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import RuleForm from "@/components/dashboard/creator/RuleForm";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys, holdsCompanyWide } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getRule } from "@/server/services/creator-commission.service";
import { actionableBranches, branchNames, creatorOptions } from "@/server/content/creator-admin";
import { getSiteIdentity } from "@/server/content/site";
import { ORDER_CHANNELS, ORDER_TYPES } from "@/lib/insights";
import { formatMoney } from "@/lib/format";
import { budgetUse, chipClass, reachSummary, rewardSummary, ruleState, specificityLabel } from "@/lib/creator";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Commission rule — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * One rule, and what it has actually paid.
 *
 * The earnings count is the point of this screen. A rule is editable after it
 * has paid — campaigns get corrected — and that is only safe because every
 * earning snapshots the values it was paid under. Saying how many earnings
 * are behind it makes clear that editing changes the future and not the past.
 */
export default async function CommissionRulePage({ params }) {
  const principal = await getAuthContext();
  const { id } = await params;
  if (!principal) redirect(loginHref(`/dashboard/commission-rules/${id}`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "creator_commission_rules.read")) redirect("/dashboard");

  // 404 rather than 403 when the rule belongs to branches outside the
  // caller's scope — the service decides, this just renders the result.
  const rule = await nullIfMissing(getRule(id, { principal }));
  if (!rule) notFound();

  const canEdit = hasPermission(permissions, "creator_commission_rules.update");

  const [branches, creators, { currency }, names] = await Promise.all([
    canEdit ? actionableBranches(principal, "creator_commission_rules.update") : [],
    canEdit ? creatorOptions() : [],
    getSiteIdentity(),
    branchNames([rule.branchIds]),
  ]);

  const shaped = serialize(rule);
  const state = ruleState(shaped);
  const reach = reachSummary(shaped, names);
  const budget = budgetUse(shaped);
  const money = (value) => formatMoney(value, currency);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={shaped.name}
        description={rewardSummary(shaped, { formatMoney: money })}
        actions={
          <Link
            href="/dashboard/commission-rules"
            className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest"
          >
            All rules
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={chipClass(state.tone)}>{state.label}</Chip>
        <Chip tone={chipClass(reach.tone)}>{reach.label}</Chip>
        <Chip>{specificityLabel(shaped)}</Chip>
        <Chip>Priority {shaped.priority}</Chip>
      </div>

      {reach.note ? (
        <p className="rounded-card bg-warning-container px-5 py-4 text-body-md text-on-warning-container">{reach.note}</p>
      ) : null}

      {budget ? (
        <p className="rounded-card bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant">
          {money(budget.spent)} of {money(budget.total)} spent
          {budget.exhausted ? " — the budget is gone, so this rule is no longer paying." : "."}
        </p>
      ) : null}

      {canEdit ? (
        <>
          <p className="rounded-card bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant">
            {shaped._count?.earnings
              ? `This rule has paid ${shaped._count.earnings} ${shaped._count.earnings === 1 ? "earning" : "earnings"}. Editing it is still safe: every earning keeps a snapshot of the values it was paid under, so a change here affects future sales only — and it is why the rule cannot be deleted once it has paid.`
              : "Nothing has been paid under this rule yet."}
          </p>
          <RuleForm
            rule={shaped}
            branches={branches}
            creators={creators}
            channels={Object.entries(ORDER_CHANNELS).map(([value, label]) => ({ value, label }))}
            orderTypes={Object.entries(ORDER_TYPES).map(([value, label]) => ({ value, label }))}
            canWriteChainWide={principal.isSuperAdmin || holdsCompanyWide(principal, "creator_commission_rules.update")}
            currency={currency}
          />
        </>
      ) : null}
    </div>
  );
}
