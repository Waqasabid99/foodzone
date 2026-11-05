import { notFound, redirect } from "next/navigation";
import { nullIfMissing } from "@/lib/api/errors";
import PageHeader from "@/components/dashboard/PageHeader";
import BranchForm from "@/components/dashboard/branches/BranchForm";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { getBranch } from "@/server/services/branch.service";
import { getSiteIdentity } from "@/server/content/site";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = {
  title: "Edit branch — FoodZone",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function EditBranchPage({ params }) {
  const { id } = await params;
  const [principal, { currency }] = await Promise.all([getAuthContext(), getSiteIdentity()]);
  if (!principal) redirect(loginHref(`/dashboard/branches/${id}/edit`));

  const permissions = grantedPermissionKeys(principal);
  // Read-only staff land on the branch itself rather than an editor that would
  // reject them on save.
  if (!hasPermission(permissions, "branches.update")) redirect(`/dashboard/branches/${id}`);

  const branch = await nullIfMissing(getBranch(id));
  if (!branch) notFound();

  // The API refuses a PATCH outside the scope; this makes the form refuse to
  // open, so nobody fills one in only to be told they may not save it.
  const scope = branchScope(principal, "branches.update");
  if (!scope.all && !scope.ids.includes(branch.id)) notFound();
  if (scope.all && scope.except?.includes(branch.id)) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Edit ${branch.name}`}
        description="Changes to the address, radius or trading status reach the website and the app immediately."
        back={{ href: `/dashboard/branches/${branch.id}`, label: branch.name }}
      />

      <BranchForm branch={branch} currency={currency} />
    </div>
  );
}
