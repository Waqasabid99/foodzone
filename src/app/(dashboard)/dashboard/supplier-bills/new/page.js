import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import BillForm from "@/components/dashboard/purchasing/BillForm";
import { getAuthContext } from "@/lib/api/auth";
import { serialize } from "@/lib/api/serialize";
import { actionableBranches, supplierOptions } from "@/server/content/purchasing-admin";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Record a bill — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Typing an invoice in by hand.
 *
 * The exception rather than the rule: a bill for a delivery already on the
 * system should be raised from that delivery, which copies the amounts across
 * instead of inviting a transcription error. This page is for everything else
 * — a service, a one-off, an invoice that arrived without any goods.
 */
export default async function NewSupplierBillPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/supplier-bills/new"));

  const branches = await actionableBranches(principal, "supplier_bills.create");
  if (!branches.length) redirect("/dashboard/supplier-bills");

  const suppliers = await supplierOptions({ includeInactive: true });

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Record a bill"
        description="A supplier's invoice, copied out as they sent it. If it is for a delivery already recorded, bill it from that delivery instead — the amounts come across on their own."
        back={{ href: "/dashboard/supplier-bills", label: "Supplier bills" }}
      />
      {suppliers.length ? (
        <BillForm branches={serialize(branches)} suppliers={serialize(suppliers)} />
      ) : (
        <p className="rounded-card bg-surface-container-lowest px-5 py-4 text-body-md text-on-surface">
          There are no suppliers yet. Add one first.
        </p>
      )}
    </div>
  );
}
