import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import DeviceForm from "@/components/dashboard/people/DeviceForm";
import { getAuthContext } from "@/lib/api/auth";
import { can } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { scopedBranches } from "@/server/content/branch-scope";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Register a terminal — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewDevicePage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/devices/new"));
  if (!can(principal, "attendance_devices.manage")) redirect("/dashboard/devices");

  const branches = await scopedBranches(principal, "attendance_devices.manage");

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Register a terminal"
        description="The key is shown once, immediately after registering, and never again. Have the terminal to hand."
        back={{ href: "/dashboard/devices", label: "Terminals" }}
      />
      <DeviceForm branches={serialize(branches)} />
    </div>
  );
}
