import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import RuleForm from "@/components/dashboard/creator/RuleForm";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys, holdsCompanyWide } from "@/lib/api/permissions";
import { actionableBranches, creatorOptions } from "@/server/content/creator-admin";
import { getSiteIdentity } from "@/server/content/site";
import { ORDER_CHANNELS, ORDER_TYPES } from "@/lib/insights";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "New commission rule — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewCommissionRulePage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/commission-rules/new"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "creator_commission_rules.create")) redirect("/dashboard/commission-rules");

  const [branches, creators, { currency }] = await Promise.all([
    actionableBranches(principal, "creator_commission_rules.create"),
    creatorOptions(),
    getSiteIdentity(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New commission rule"
        description="What a creator earns when their video sells something. Exactly one rule pays per sale, so think about which existing rule this should outrank."
      />
      <RuleForm
        branches={branches}
        creators={creators}
        channels={Object.entries(ORDER_CHANNELS).map(([value, label]) => ({ value, label }))}
        orderTypes={Object.entries(ORDER_TYPES).map(([value, label]) => ({ value, label }))}
        canWriteChainWide={principal.isSuperAdmin || holdsCompanyWide(principal, "creator_commission_rules.create")}
        currency={currency}
      />
    </div>
  );
}
