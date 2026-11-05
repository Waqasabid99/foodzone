import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import SupplierForm from "@/components/dashboard/purchasing/SupplierForm";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Add supplier — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewSupplierPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/suppliers/new"));
  if (!hasPermission(grantedPermissionKeys(principal), "suppliers.create")) redirect("/dashboard/suppliers");

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Add a supplier"
        description="The details that end up on a purchase order, and the terms that decide when their invoices fall due."
        back={{ href: "/dashboard/suppliers", label: "Suppliers" }}
      />
      <SupplierForm />
    </div>
  );
}
