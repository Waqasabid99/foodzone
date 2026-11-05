import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import AccountForm from "@/components/dashboard/finance/AccountForm";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys, holdsCompanyWide } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { accountOptions, scopedBranches } from "@/server/content/finance-admin";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "New account — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewAccountPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/accounts/new"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "accounts.create")) redirect("/dashboard/accounts");
  // A shared account belongs to every branch, so a grant pinned to one outlet
  // cannot authorise creating it. The API refuses this too.
  if (!holdsCompanyWide(principal, "accounts.create")) redirect("/dashboard/accounts");

  const [parents, branches] = await Promise.all([accountOptions(), scopedBranches(principal, "accounts.create")]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New account"
        description="A place for the books to post to. Think about what will be read off it in a report before adding one — a chart with too many accounts is harder to read than one with too few."
        back={{ href: "/dashboard/accounts", label: "Chart of accounts" }}
      />
      <AccountForm parents={serialize(parents)} branches={serialize(branches)} />
    </div>
  );
}
