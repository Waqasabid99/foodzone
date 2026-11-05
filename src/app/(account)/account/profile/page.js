import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import ProfileForm from "@/components/account/ProfileForm";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getProfile } from "@/server/services/profile.service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "My profile — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function MyProfilePage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/account/profile"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "self.view_profile")) redirect("/account");

  const profile = serialize(await getProfile(principal));

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="My profile" description="Your details, and your password." />
      <ProfileForm profile={profile} canEdit={hasPermission(permissions, "self.update_profile")} />
    </div>
  );
}
