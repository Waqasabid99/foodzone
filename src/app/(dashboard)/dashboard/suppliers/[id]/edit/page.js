import { notFound, redirect } from "next/navigation";
import { nullIfMissing } from "@/lib/api/errors";
import PageHeader from "@/components/dashboard/PageHeader";
import SupplierForm from "@/components/dashboard/purchasing/SupplierForm";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getSupplier } from "@/server/services/supplier.service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Edit supplier — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function EditSupplierPage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/suppliers/${id}/edit`));
  if (!hasPermission(grantedPermissionKeys(principal), "suppliers.update")) redirect(`/dashboard/suppliers/${id}`);

  const raw = await nullIfMissing(getSupplier(id));
  if (!raw) notFound();
  const supplier = serialize(raw);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={`Edit ${supplier.name}`}
        description="Changing the terms changes the due date on bills recorded from now on. Bills already raised keep the date they were given."
        back={{ href: `/dashboard/suppliers/${id}`, label: supplier.name }}
      />
      <SupplierForm supplier={supplier} />
    </div>
  );
}
