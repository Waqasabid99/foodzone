import { redirect } from "next/navigation";
import { Smartphone } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import DeviceList from "@/components/account/DeviceList";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listDevices } from "@/server/services/device.service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";
import { getSiteIdentity } from "@/server/content/site";

export const metadata = { title: "My devices — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function MyDevicesPage() {
  const { timeZone } = await getSiteIdentity();
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/account/devices"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "self.manage_devices")) redirect("/account");

  const devices = serialize(await listDevices({ userId: principal.userId }));

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="My devices"
        description="Phones and browsers set up to get order notifications. Remove any you do not recognise."
      />

      {devices.length ? (
        <DeviceList devices={devices} timeZone={timeZone} />
      ) : (
        <EmptyState icon={Smartphone} title="No devices yet">
          A device is added when you allow notifications in the app or on this site.
        </EmptyState>
      )}
    </div>
  );
}
