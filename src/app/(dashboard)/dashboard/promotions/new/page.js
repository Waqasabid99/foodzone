import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import PromotionForm from "@/components/dashboard/marketing/PromotionForm";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys, holdsCompanyWide } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { actionableBranches } from "@/server/content/marketing-admin";
import { getSiteIdentity } from "@/server/content/site";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "New offer — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewPromotionPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/promotions/new"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "promotions.create")) redirect("/dashboard/promotions");

  const [branches, { currency }] = await Promise.all([
    actionableBranches(principal, "promotions.create"),
    getSiteIdentity(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New offer"
        description="A discount is a rule. The summary on the right says what the rule you are building will actually do — worth reading before saving, because an offer that is wrong does not fail, it just never fires."
        back={{ href: "/dashboard/promotions", label: "Promotions" }}
      />
      <PromotionForm
        branches={serialize(branches)}
        canGoChainWide={holdsCompanyWide(principal, "promotions.create")}
        currency={currency}
      />
    </div>
  );
}
