import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import ModifierGroupForm from "@/components/dashboard/modifiers/ModifierGroupForm";
import { getWorkspaceViewer } from "@/server/auth/workspace";
import { getSiteIdentity } from "@/server/content/site";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "New modifier group — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewModifierGroupPage() {
  const [viewer, { currency }] = await Promise.all([getWorkspaceViewer(), getSiteIdentity()]);
  if (!viewer) redirect(loginHref("/dashboard/modifiers/new"));
  if (!hasPermission(viewer.permissions, "modifiers.create")) redirect("/dashboard/modifiers");

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="New modifier group" back={{ href: "/dashboard/modifiers", label: "Modifiers" }} />
      <ModifierGroupForm currency={currency} />
    </div>
  );
}
