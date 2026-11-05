import { redirect } from "next/navigation";
import { Scale } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import TaxEditor from "@/components/dashboard/finance/TaxEditor";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys, holdsCompanyWide } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { accountOptions, taxGroupsWithRates } from "@/server/content/finance-admin";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Taxes — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Tax groups and the rates inside them.
 *
 * Company data with no branch column at all — a VAT rate pinned to one outlet
 * is not something the schema can express — so changing anything here needs a
 * company-wide grant. Reading is open to anyone who may read taxes, because a
 * manager wanting to know what their menu charges is not a secret.
 */
export default async function TaxesPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/taxes"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "taxes.read")) redirect("/dashboard");

  const [groups, accounts] = await Promise.all([
    taxGroupsWithRates(),
    accountOptions(),
  ]);

  const canManage = holdsCompanyWide(principal, "taxes.manage");
  const liabilities = accounts.filter((account) => account.type === "LIABILITY");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Taxes"
        description="What the menu charges on top of a price, or inside it. Products point at a group rather than at a rate, so a rate can change without touching a thousand products."
      />

      {!canManage && hasPermission(permissions, "taxes.manage") ? (
        <p className="rounded-card bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant">
          Your permission to manage taxes is pinned to a branch. A tax group has no branch — it is what every outlet
          charges — so editing takes a company-wide grant and is read-only here.
        </p>
      ) : null}

      {groups.length ? (
        <TaxEditor groups={serialize(groups)} accounts={serialize(liabilities)} canManage={canManage} />
      ) : canManage ? (
        <TaxEditor groups={[]} accounts={serialize(liabilities)} canManage />
      ) : (
        <EmptyState icon={Scale} title="No tax groups">
          Without a group, nothing on the menu charges tax.
        </EmptyState>
      )}
    </div>
  );
}
