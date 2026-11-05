import { redirect } from "next/navigation";
import { MapPin } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import AddressBook from "@/components/account/AddressBook";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listAddresses } from "@/server/services/address.service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "My addresses — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function MyAddressesPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/account/addresses"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "self.manage_addresses")) redirect("/account");

  const addresses = serialize(await listAddresses({ userId: principal.userId }));

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="My addresses"
        description="Where we deliver. The default one is filled in for you at checkout."
      />

      {addresses.length ? (
        <AddressBook addresses={addresses} />
      ) : (
        <>
          <EmptyState icon={MapPin} title="No addresses yet">
            Add one here, or the first time you check out.
          </EmptyState>
          <AddressBook addresses={[]} />
        </>
      )}
    </div>
  );
}
