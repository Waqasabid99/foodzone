import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import BranchForm from "@/components/dashboard/branches/BranchForm";
import { getWorkspaceViewer } from "@/server/auth/workspace";
import { getSiteIdentity } from "@/server/content/site";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = {
  title: "New branch — FoodZone",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function NewBranchPage() {
  const [viewer, { currency }] = await Promise.all([getWorkspaceViewer(), getSiteIdentity()]);
  if (!viewer) redirect(loginHref("/dashboard/branches/new"));

  // Someone who may read branches but not create one is sent back to the list
  // rather than shown a form that would be refused on submit.
  if (!hasPermission(viewer.permissions, "branches.create")) redirect("/dashboard/branches");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New branch"
        description="Only the name and the code are required — the rest can be filled in as the outlet gets set up."
        back={{ href: "/dashboard/branches", label: "Branches" }}
      />

      <BranchForm currency={currency} />
    </div>
  );
}
