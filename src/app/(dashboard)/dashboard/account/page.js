import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import { MyPasswordForm, MyProfileForm } from "@/components/dashboard/admin/MyAccountForms";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { serialize } from "@/lib/api/serialize";
import { getProfile } from "@/server/services/profile.service";
import { roleSummary } from "@/lib/people";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Your account — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Your own details and password. Everyone signed in can reach this. */
export default async function MyAccountPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/account"));

  const me = serialize(await getProfile(principal));

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Your account"
        description={me.email ?? me.phone ?? ""}
        actions={principal.roles.length ? <Chip>{roleSummary(principal.roles)}</Chip> : null}
      />

      <Section title="Your details">
        <MyProfileForm user={me} />
      </Section>

      <Section title="Password" description="Nobody else should ever know it — not even an administrator.">
        <MyPasswordForm />
      </Section>
    </div>
  );
}
