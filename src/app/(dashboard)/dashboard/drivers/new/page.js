import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import DriverForm from "@/components/dashboard/delivery/DriverForm";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { actionableBranches, linkableAccounts } from "@/server/content/delivery-admin";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Add driver — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewDriverPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/drivers/new"));
  if (!hasPermission(grantedPermissionKeys(principal), "drivers.create")) redirect("/dashboard/drivers");

  const [accounts, branches] = await Promise.all([
    linkableAccounts({ take: 100 }),
    actionableBranches(principal, "drivers.create"),
  ]);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Add a driver"
        description="Built on top of a sign-in account, so they can open the driver app and be given work."
        back={{ href: "/dashboard/drivers", label: "Drivers" }}
      />
      <DriverForm accounts={serialize(accounts)} branches={serialize(branches)} />
    </div>
  );
}
